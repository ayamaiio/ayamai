import importlib.util
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("local_dev", pathlib.Path(__file__).parents[1] / "local-dev.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class LifecycleSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.local = pathlib.Path(self.tmp.name)
        for name, value in (("LOCAL", self.local), ("STATE", self.local / "servers.json")):
            p = patch.object(dev, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.c = dict(api=8181, web=25322, magi=6106, db=5534, database="agent_test", mode="clerk", container="agent-test")

    def env_file(self, extra=""):
        (self.local / "runtime.env").write_text("DATABASE_URL=postgresql://local:local@127.0.0.1:5534/agent_test\n")
        (self.local / "dev.env").write_text("CLERK_PUBLISHABLE_KEY=pk_test_example\nCLERK_SECRET_KEY=sk_test_example\n" + extra)

    def test_ambient_credentials_and_node_options_are_not_inherited(self):
        self.env_file()
        with patch.dict(os.environ, {"AWS_SECRET_ACCESS_KEY": "never-forward", "NODE_OPTIONS": "--require=bad", "DATABASE_URL": "remote"}):
            env = dev.environment(self.c)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", env)
        self.assertNotIn("NODE_OPTIONS", env)
        self.assertIn("127.0.0.1:5534", env["DATABASE_URL"])

    def test_remote_and_wrong_local_database_are_rejected(self):
        self.env_file()
        for url in ("postgresql://local:local@example.org:5534/agent_test", "postgresql://local:local@127.0.0.1:5434/ayamai_local"):
            (self.local / "runtime.env").write_text("DATABASE_URL=" + url)
            with self.assertRaises(SystemExit):
                dev.environment(self.c)

    def test_live_keys_and_unknown_entries_are_rejected(self):
        for extra in ("CLERK_SECRET_KEY=sk_live_no", "R2_SECRET_ACCESS_KEY=no", "NODE_ENV=production", "AYAMAI_DEV_AUTH_MODE=local-founder"):
            self.env_file(extra)
            with self.assertRaises(SystemExit):
                dev.environment(self.c)

    def test_occupied_port_is_preserved(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            with self.assertRaises(SystemExit):
                dev.free_ports([listener.getsockname()[1]])
            self.assertGreater(listener.fileno(), 0)

    def test_configuration_preserves_founder_boundary_and_agent_database(self):
        name = "ayamai-dev-" + hashlib.sha256(str(dev.ROOT).encode()).hexdigest()[:12]
        c = dict(self.c, container=name, database=name.replace("-", "_"))
        path = self.local / "dev.json"
        with patch.object(dev, "CONFIG", path):
            path.write_text(json.dumps(c))
            self.assertEqual(dev.config()["db"], 5534)
            for broken in (dict(c, db=5434), dict(c, database="ayamai_local"), dict(c, mode="local-founder"), dict(c, web=c["api"]), dict(c, curator=c["api"]), dict(c, curator=4319)):
                path.write_text(json.dumps(broken))
                with self.assertRaises(SystemExit):
                    dev.config()

    def test_dotenv_is_refused_without_reading_it(self):
        (self.local / ".env.local").write_text("do-not-load")
        with patch.object(dev, "ROOT", self.local):
            with self.assertRaisesRegex(SystemExit, "dotenv"):
                dev.preflight(self.c, ["magi"])

    def test_unowned_process_is_never_signalled(self):
        process = subprocess.Popen(["sleep", "10"])
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.terminate() if process.poll() is None else None)
        dev.save({"api": dev.identity(process.pid)})
        with patch.object(dev.os, "killpg") as kill:
            with self.assertRaises(SystemExit):
                dev.stop(["api"])
        kill.assert_not_called()
        self.assertIsNone(process.poll())

    def test_real_owned_process_can_be_stopped_without_touching_other_services(self):
        process = subprocess.Popen(["sleep", "10"], cwd=dev.ROOT, start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.terminate() if process.poll() is None else None)
        dev.save({"api": dev.identity(process.pid), "magi": {"pid": 99999999, "start": "1", "boot": dev.BOOT}})
        self.assertTrue(dev.owned(dev.state()["api"]))
        dev.stop(["api"])
        self.assertEqual(set(dev.state()), {"magi"})
        process.wait(timeout=2)

    def test_stale_pid_record_does_not_signal_replacement(self):
        process = subprocess.Popen(["sleep", "10"], cwd=dev.ROOT, start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.terminate() if process.poll() is None else None)
        item = dev.identity(process.pid)
        item["start"] = "wrong-start"
        dev.save({"api": item})
        with patch.object(dev.os, "killpg") as kill:
            with self.assertRaises(SystemExit):
                dev.stop(["api"])
        kill.assert_not_called()

    def test_failed_launch_rolls_back_only_new_services(self):
        self.env_file()
        old = {"magi": {"pid": 99999999, "start": "1", "boot": dev.BOOT}}
        dev.save(old)
        with patch.object(dev, "preflight"), patch.object(dev, "db_start"), patch.object(dev, "free_ports"), patch.object(dev.subprocess, "run"), patch.object(dev.subprocess, "Popen", side_effect=OSError("launch failed")):
            with self.assertRaises(OSError):
                dev.start(self.c, ["api"])
        self.assertEqual(dev.state(), old)

    def test_empty_schema_blocks_start_without_running_migrations(self):
        self.env_file()
        with patch.object(dev, "free_ports"), patch.object(dev.pathlib.Path, "exists", return_value=True), patch.object(dev.shutil, "which", return_value="/tool"), patch.object(dev, "inspect_db", return_value={"State": {"Running": True}}), patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, stdout="0\n")) as run:
            with self.assertRaisesRegex(SystemExit, "schema missing"):
                dev.preflight(self.c, ["api"])
        self.assertEqual(run.call_count, 1)
        self.assertIn("SELECT count(*)", run.call_args.args[0][-1])

    def bootstrap_ticket(self):
        (self.local / "bootstrap-owner.json").write_text(json.dumps({"container_id": "new-container"}))

    def test_bootstrap_refuses_missing_or_wrong_provenance_before_sql(self):
        for ticket in (None, {"container_id": "other"}):
            if ticket:
                (self.local / "bootstrap-owner.json").write_text(json.dumps(ticket))
            with patch.object(dev, "inspect_db", return_value={"Id": "new-container"}), patch.object(dev, "db_sql") as sql:
                with self.assertRaisesRegex(SystemExit, "provenance"):
                    dev.bootstrap_schema(self.c)
                sql.assert_not_called()

    def test_bootstrap_repeat_has_no_schema_writes(self):
        self.bootstrap_ticket()
        manifest = json.loads((dev.ROOT / "scripts/local-schema/manifest.json").read_text())
        with patch.object(dev, "inspect_db", return_value={"Id": "new-container"}), patch.object(dev, "db_sql", side_effect=["state", manifest["sql_sha256"]]) as sql:
            dev.bootstrap_schema(self.c)
        self.assertEqual(sql.call_count, 2)
        self.assertTrue(all(call.args[1].startswith("SELECT") for call in sql.call_args_list))

    def test_bootstrap_refuses_changed_existing_fingerprint(self):
        self.bootstrap_ticket()
        with patch.object(dev, "inspect_db", return_value={"Id": "new-container"}), patch.object(dev, "db_sql", side_effect=["state", "different"]) as sql:
            with self.assertRaisesRegex(SystemExit, "never upgrades"):
                dev.bootstrap_schema(self.c)
        self.assertEqual(sql.call_count, 2)

    def test_bootstrap_is_single_transaction_with_nonempty_guard(self):
        self.bootstrap_ticket()
        with patch.object(dev, "inspect_db", return_value={"Id": "new-container"}), patch.object(dev, "db_sql", side_effect=["", ""]) as sql:
            dev.bootstrap_schema(self.c)
        statement = sql.call_args.args[1]
        self.assertIn("BEGIN;", statement)
        self.assertIn("Refusing nonempty local database", statement)
        self.assertLess(statement.index("pg_advisory_xact_lock"), statement.index("CREATE TABLE"))
        self.assertTrue(statement.rstrip().endswith("COMMIT;"))


    def test_partial_launch_failure_stops_new_process_and_preserves_sibling(self):
        self.env_file()
        old = {"magi": {"pid": 99999999, "start": "1", "boot": dev.BOOT}}
        dev.save(old)
        real_popen = subprocess.Popen
        launched = []

        def launch(command, **kwargs):
            if launched:
                raise OSError("second launch failed")
            process = real_popen(["sleep", "10"], **kwargs)
            launched.append(process)
            self.addCleanup(process.wait)
            self.addCleanup(lambda: process.terminate() if process.poll() is None else None)
            return process

        with patch.object(dev, "preflight"), patch.object(dev, "db_start"), patch.object(dev, "free_ports"), patch.object(dev.subprocess, "run"), patch.object(dev.subprocess, "Popen", side_effect=launch):
            with self.assertRaises(OSError):
                dev.start(self.c, ["api", "web"])
        launched[0].wait(timeout=2)
        self.assertEqual(dev.state(), old)


if __name__ == "__main__":
    unittest.main()
