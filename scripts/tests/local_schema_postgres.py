"""Opt-in integration check; creates only new synthetic DBs in this worktree's container.
Run after setup: python3 scripts/tests/local_schema_postgres.py
Retains databases for inspection; never connects to an ambient DATABASE_URL.
"""
import importlib.util
import pathlib
import subprocess
import uuid

spec = importlib.util.spec_from_file_location("local_dev", pathlib.Path(__file__).parents[1] / "local-dev.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)
c = dev.config()
dev.inspect_db(c)
prefix = "bootstrap_test_" + uuid.uuid4().hex
for suffix, occupied in (("_empty", False), ("_table", True), ("_schema", True), ("_pgschema", True)):
    target = dict(c, database=prefix + suffix)
    dev.db_sql(c, 'CREATE DATABASE "' + target["database"] + '";')
    if suffix == "_table":
        dev.db_sql(target, "CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES ('preserve');")
    elif suffix == "_schema":
        dev.db_sql(target, "CREATE SCHEMA sentinel;")
    elif suffix == "_pgschema":
        dev.db_sql(target, "CREATE SCHEMA pgcustom;")
    if occupied:
        try:
            dev.bootstrap_schema(target)
        except subprocess.CalledProcessError as error:
            assert "Refusing nonempty local database" in error.stderr
        else:
            raise AssertionError("Nonempty database was accepted")
        assert not dev.db_sql(target, "SELECT to_regclass('public.media_items');")
        if suffix == "_table":
            assert dev.db_sql(target, "SELECT value FROM sentinel;") == "preserve"
        print(suffix, "refused; existing objects preserved; no partial bootstrap")
    else:
        dev.bootstrap_schema(target)
        assert dev.db_sql(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") == "35"
        dev.db_sql(target, "INSERT INTO social_accounts (user_id) VALUES ('synthetic-preserve');")
        dev.bootstrap_schema(target)
        assert dev.db_sql(target, "SELECT count(*) FROM social_accounts WHERE user_id='synthetic-preserve';") == "1"
        print("empty bootstrap and repeat idempotence passed")
