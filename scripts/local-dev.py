#!/usr/bin/env python3
"""Unified local development for Ubuntu/WSL. No cloud credentials; bootstrap only new empty local databases."""
import argparse
import collections
import fcntl
import hashlib
import json
import os
import pathlib
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import time
import urllib.request
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
STATE = LOCAL / "servers.json"
CONFIG = LOCAL / "dev.json"
BOOT = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
SERVICES = ("front", "api", "web", "magi", "curator")


def fail(message):
    raise SystemExit(message)


def clean_environment():
    env = {k: os.environ[k] for k in ("HOME", "USER", "LANG", "TMPDIR") if k in os.environ}
    env["PATH"] = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
    # Never inherit NODE_OPTIONS, cloud credentials, proxy settings or dotenv.
    return env


def run(command, **kwargs):
    return subprocess.run(command, cwd=ROOT, env=clean_environment(), check=True, **kwargs)


def config():
    if not CONFIG.exists():
        fail("Run python3 scripts/local-dev.py setup first (see docs/unified-local-development.md).")
    result = json.loads(CONFIG.read_text())
    result.setdefault("curator", 4319 + result["api"] - 8081)
    if "front" not in result:
        # One door: the gateway takes 25222, Vite moves behind it at 25322.
        result["front"] = 25222
        if result.get("web") == 25222:
            result["web"] = 25322
    ports = [result[k] for k in ("front", "api", "web", "magi", "db", "curator")]
    if any(type(p) is not int or not 1024 <= p <= 65535 for p in ports) or len(set(ports)) != 6:
        fail("dev.json requires five distinct ports between 1024 and 65535.")
    if result["mode"] not in ("local-founder", "clerk"):
        fail("Invalid local auth mode.")
    if result["mode"] == "local-founder" and (result["front"], result["db"], result["database"]) != (25222, 5434, "ayamai_local"):
        fail("Founder security guards require the front door on 25222 and 5434/ayamai_local; use Clerk test mode for agents.")
    if result["mode"] == "clerk" and set(ports) & {8081, 25222, 6006, 5434, 4319}:
        fail("Agent ports must be separate from every founder port.")
    expected = "ayamai-dev-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
    database = "ayamai_local" if result["mode"] == "local-founder" else expected.replace("-", "_")
    if result["container"] != expected or result["database"] != database:
        fail("Unexpected database identity in dev.json.")
    return result


def identity(pid):
    try:
        stat = pathlib.Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()
        if stat[0] == "Z":
            return None
        return {"pid": pid, "start": stat[19], "boot": BOOT}
    except FileNotFoundError:
        return None


def owned(item):
    try:
        return identity(item["pid"]) == item and os.getpgid(item["pid"]) == item["pid"] and pathlib.Path(f"/proc/{item['pid']}/cwd").resolve() == ROOT
    except (ProcessLookupError, FileNotFoundError):
        return False


def state():
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save(items):
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(items))
    temp.chmod(0o600)
    temp.replace(STATE)


def free_ports(ports):
    for port in ports:
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                fail(f"Port {port} occupied; no existing service stopped. Choose isolated agent ports.")


def environment(c):
    env = clean_environment()
    allowed = {"DATABASE_URL", "NODE_ENV", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "AYAMAI_LOCAL_MEDIA_ROOT", "SESSION_SECRET", "AYAMAI_DEV_AUTH_MODE", "AYAMAI_CURATOR_ENABLED"}
    for name in ("runtime.env", "dev.env"):
        path = LOCAL / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            parts = shlex.split(line, comments=True)
            if parts and parts[0] == "export":
                parts.pop(0)
            for part in parts:
                key, sep, value = part.partition("=")
                if not sep or key not in allowed:
                    fail("Unsupported local configuration entry.")
                env[key] = value
    db = urlparse(env.get("DATABASE_URL", ""))
    if db.scheme not in ("postgres", "postgresql") or db.hostname != "127.0.0.1" or db.port != c["db"] or db.path != "/" + c["database"]:
        fail("DATABASE_URL must match this worktree's isolated loopback database.")
    if env.get("NODE_ENV", "development") != "development" or env.get("AYAMAI_DEV_AUTH_MODE", c["mode"]) != c["mode"]:
        fail("Environment must use development and the configured auth mode.")
    pk, sk = env.get("CLERK_PUBLISHABLE_KEY", ""), env.get("CLERK_SECRET_KEY", "")
    if (pk and not pk.startswith("pk_test_")) or (sk and not sk.startswith("sk_test_")):
        fail("Only Clerk development keys are accepted.")
    if c["mode"] == "clerk" and (not pk or not sk):
        fail("Agent mode requires Clerk test keys in .local/dev.env; MAGI can run without them.")
    env.update(AYAMAI_CURATOR_ENABLED="true", NODE_ENV="development", HOST="127.0.0.1", BASE_PATH="/yoru",
               API_PROXY_TARGET=f"http://127.0.0.1:{c['api']}",
               AYAMAI_DEV_AUTH_MODE=c["mode"], VITE_AYAMAI_DEV_AUTH_MODE=c["mode"],
               VITE_CLERK_PUBLISHABLE_KEY=pk)
    return env


def inspect_db(c):
    result = run(["docker", "container", "inspect", c["container"]], capture_output=True, text=True)
    item = json.loads(result.stdout)[0]
    if item["Config"].get("Labels", {}).get("io.ayamai.worktree") != str(ROOT):
        fail("Refusing database container owned by another checkout.")
    ports = item["HostConfig"]["PortBindings"].get("5432/tcp")
    if ports != [{"HostIp": "127.0.0.1", "HostPort": str(c["db"])}]:
        fail("Unexpected database port binding.")
    mounts = [m for m in item["Mounts"] if m["Destination"] == "/var/lib/postgresql/data"]
    if len(mounts) != 1 or mounts[0]["Type"] != "volume" or mounts[0]["Name"] != c["container"]:
        fail("Unexpected database data volume; refusing shared or bind-mounted storage.")
    return item


def db_start(c):
    item = inspect_db(c)
    if not item["State"]["Running"]:
        free_ports([c["db"]])
        run(["docker", "start", c["container"]], stdout=subprocess.DEVNULL)
    for _ in range(60):
        result = subprocess.run(["docker", "exec", c["container"], "pg_isready", "-h", "127.0.0.1", "-U", "ayamai_local", "-d", c["database"]],
                                env=clean_environment(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            return
        time.sleep(.5)
    fail("Local database readiness timed out.")


def db_sql(c, sql):
    # Never accepts a connection URL: execute inside the verified owned container.
    inspect_db(c)
    return run(["docker", "exec", "-i", c["container"], "psql", "-X", "-v", "ON_ERROR_STOP=1",
                "-U", "ayamai_local", "-d", c["database"], "-At"],
               input=sql, capture_output=True, text=True).stdout.strip()


def bootstrap_schema(c):
    item = inspect_db(c)
    ticket = LOCAL / "bootstrap-owner.json"
    if not ticket.exists() or json.loads(ticket.read_text()) != {"container_id": item["Id"]}:
        fail("Refusing schema initialization without provenance for a newly created local database.")
    directory = ROOT / "scripts/local-schema"
    manifest = json.loads((directory / "manifest.json").read_text())
    source = hashlib.sha256()
    for path in sorted((ROOT / "lib/db/src/schema").glob("*.ts")):
        source.update(path.name.encode())
        source.update(path.read_bytes())
    sql = (directory / "bootstrap.sql").read_text()
    fingerprint = hashlib.sha256(sql.encode()).hexdigest()
    if source.hexdigest() != manifest["source_sha256"] or fingerprint != manifest["sql_sha256"]:
        fail("Local bootstrap/schema fingerprint mismatch; regenerate and review bootstrap SQL.")
    marker = db_sql(c, "SELECT to_regclass('ayamai_local_bootstrap.state');")
    if marker:
        if db_sql(c, "SELECT fingerprint FROM ayamai_local_bootstrap.state;") != fingerprint:
            fail("Existing local schema differs; setup never upgrades existing databases.")
        print("Local schema already initialized; no schema writes.")
        return
    db_sql(c, """
BEGIN;
SELECT pg_advisory_xact_lock(617326104);
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN
    ('public','information_schema') AND left(nspname, 3) <> 'pg_')
 OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
 OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
 THEN RAISE EXCEPTION 'Refusing nonempty local database; no migrations applied';
 END IF;
END $guard$;
""" + sql + """
CREATE SCHEMA ayamai_local_bootstrap;
CREATE TABLE ayamai_local_bootstrap.state (fingerprint text PRIMARY KEY);
INSERT INTO ayamai_local_bootstrap.state VALUES ('""" + fingerprint + """');
COMMIT;
""")
    print("Initialized empty owned local database transactionally.")


def setup(args):
    if not shutil.which("node") or not shutil.which("pnpm") or not shutil.which("docker"):
        fail("Install Node 24+, pnpm 10.34.9 and Docker with WSL integration; put them on PATH.")
    version = run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    pnpm = run(["pnpm", "--version"], capture_output=True, text=True).stdout.strip()
    if int(version.lstrip("v").split(".")[0]) < 24 or pnpm != "10.34.9":
        fail("Use Node 24+ and pnpm 10.34.9.")
    if not CONFIG.exists():
        if (LOCAL / "runtime.env").exists() or (LOCAL / "dev.env").exists():
            fail("Existing local environment preserved. Use a fresh worktree for setup.")
        if args.agent and args.port_offset is None:
            fail("Agent setup requires an explicit --port-offset (e.g. 100).")
        offset = args.port_offset or 0
        if args.agent and offset <= 0:
            fail("Agent offset must be positive and reserve distinct founder ports.")
        name = "ayamai-dev-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
        c = dict(api=8081+offset, web=25222+offset, magi=6006+offset, db=5434+offset, curator=4319+offset,
                 mode="clerk" if args.agent else "local-founder",
                 database=name.replace("-", "_") if args.agent else "ayamai_local", container=name)
        # Validate before writing configuration.
        ports = [c[k] for k in ("api", "web", "magi", "db", "curator")]
        if len(set(ports)) != 5 or any(not 1024 <= p <= 65535 for p in ports):
            fail("Invalid port offset.")
        if args.agent and set(ports) & {8081, 25222, 6006, 5434, 4319}:
            fail("Agent ports must not overlap founder ports.")
        if not args.agent and offset:
            fail("Port offsets require --agent; founder ports are fixed.")
        free_ports([c["db"]])
        CONFIG.write_text(json.dumps(c, indent=2) + "\n")
        password = secrets.token_hex(24)
        (LOCAL / "postgres.env").write_text(f"POSTGRES_USER=ayamai_local\nPOSTGRES_DB={c['database']}\nPOSTGRES_PASSWORD={password}\n")
        (LOCAL / "runtime.env").write_text(
            f"DATABASE_URL=postgresql://ayamai_local:{password}@127.0.0.1:{c['db']}/{c['database']}\n"
            f"AYAMAI_LOCAL_MEDIA_ROOT={shlex.quote(str(LOCAL / 'media'))}\nSESSION_SECRET={secrets.token_hex(32)}\n")
        (LOCAL / "dev.env").write_text(f"AYAMAI_DEV_AUTH_MODE={c['mode']}\nCLERK_PUBLISHABLE_KEY=\nCLERK_SECRET_KEY=\n")
        (LOCAL / "media").mkdir(mode=0o700, exist_ok=True)
    c = config()
    # Install noninteractively without inheriting ambient credentials/configuration.
    subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=ROOT,
                   env=dict(clean_environment(), CI="true"), check=True)
    result = subprocess.run(["docker", "container", "inspect", c["container"]], env=clean_environment(),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode:
        volume = subprocess.run(["docker", "volume", "inspect", c["container"]],
                                env=clean_environment(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if volume.returncode == 0:
            fail("Existing database volume preserved; refusing adoption or initialization.")
        free_ports([c["db"]])
        run(["docker", "run", "-d", "--name", c["container"], "--label", "io.ayamai.worktree=" + str(ROOT),
             "--env-file", str(LOCAL / "postgres.env"), "-p", f"127.0.0.1:{c['db']}:5432",
             "-v", c["container"] + ":/var/lib/postgresql/data", "postgres:16"], stdout=subprocess.DEVNULL)
        item = inspect_db(c)
        (LOCAL / "bootstrap-owner.json").write_text(json.dumps({"container_id": item["Id"]}))
    db_start(c)
    bootstrap_schema(c)
    curator_dir = LOCAL / "curator"
    curator_dir.mkdir(mode=0o700, exist_ok=True)
    curator_config = curator_dir / "config.json"
    if not curator_config.exists():
        shutil.copyfile(ROOT / "projects/yoru/curator/config.example.json", curator_config)
        curator_config.chmod(0o600)
    print("Setup complete: dependencies, private local config and initialized isolated database.")
    print("Next: pnpm dev (agent mode requires intentionally supplied Clerk test keys).")


def preflight(c, selected, check_ports=True):
    # Vite normally loads dotenv itself. Refuse those files without reading them.
    for directory in (ROOT, ROOT / 'projects/yoru/app', ROOT / 'apps/magi', ROOT / 'apps/magi/.storybook'):
        if any(p.name == '.env' or p.name.startswith('.env.') and not p.name.endswith(('.example', '.sample')) for p in directory.glob('.env*')):
            fail('Repository dotenv file detected; use a clean worktree and .local configuration only.')
    for tool in ("node", "pnpm"):
        if not shutil.which(tool):
            fail(f"Missing {tool}; see quickstart.")
    if not (ROOT / "node_modules").exists():
        fail("Dependencies missing; run setup.")
    if check_ports:
        free_ports([c[s] for s in selected])
    if "magi" in selected and not (ROOT / "apps/magi/package.json").exists():
        fail("MAGI is missing; use the MAGI feature branch.")
    if any(s in selected for s in ("api", "web")):
        environment(c)
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            fail("Install ffmpeg (including ffprobe) for intake previews.")
        item = inspect_db(c)
        if not item["State"]["Running"]:
            fail("Database stopped; run db-start.")
        # Read-only schema probe; no migrations or implicit snapshot restore.
        result = run(["docker", "exec", c["container"], "psql", "-U", "ayamai_local", "-d", c["database"], "-Atc",
                      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('access_memberships','social_accounts','import_jobs','import_files','media_items','media_annotations','label_exports','label_export_rows')"],
                     capture_output=True, text=True)
        if result.stdout.strip() != "8":
            fail("Local schema missing/incomplete. Run setup for a new empty local database; existing databases are never migrated.")
    print("Preflight passed (configuration, ports, dependencies and selected prerequisites).")


def stop(selected):
    saved = state()
    for name in selected:
        item = saved.get(name)
        if item and identity(item["pid"]) is not None and not owned(item):
            fail(f"Refusing unfamiliar process for {name}.")
    for name in selected:
        item = saved.get(name)
        if item and owned(item):
            os.killpg(item["pid"], signal.SIGTERM)
    for _ in range(100):
        if not any(saved.get(s) and owned(saved[s]) for s in selected):
            break
        time.sleep(.1)
    else:
        fail("Servers still shutting down; no forced kill performed.")
    for name in selected:
        saved.pop(name, None)
    save(saved)
    print("Selected local servers stopped; database and media retained.")


def start(c, selected):
    saved = state()
    if any(saved.get(s) and owned(saved[s]) for s in selected):
        fail("Selected service already running; use status or restart.")
    free_ports([c[s] for s in selected])
    if any(s in selected for s in ("api", "web")):
        environment(c)
        db_start(c)
    preflight(c, selected)
    env = environment(c) if any(s in selected for s in ("api", "web")) else clean_environment()
    if "api" in selected:
        subprocess.run(["pnpm", "--filter", "@workspace/api-server", "build"], cwd=ROOT, env=env, check=True)
    commands = {
        "front": ["node", "scripts/gateway.mjs"],
        "curator": ["node", "projects/yoru/curator/server.mjs"],
        "api": ["node", "--enable-source-maps", "projects/yoru/api/dist/index.mjs"],
        "web": ["pnpm", "--filter", "@workspace/private-media-library", "exec", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1"],
        "magi": ["pnpm", "--filter", "magi", "exec", "storybook", "dev", "-p", str(c["magi"]), "--host", "127.0.0.1", "--no-open", "--ci", "--disable-telemetry"],
    }
    started = []
    try:
        for name in selected:
            if name == "curator" and c["mode"] == "local-founder" and "api" in selected and not (LOCAL / "curator/data/api-token").exists():
                for attempt in range(100):
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{c['api']}/api/healthz", timeout=1):
                            break
                    except OSError:
                        time.sleep(.2)
                else:
                    raise RuntimeError("API did not become ready for local Curator pairing.")
                run(["node", "projects/yoru/curator/pair.mjs"])
            service_env = dict(env, PORT=str(c[name]))
            if name == "curator":
                service_env = dict(clean_environment(), PORT=str(c[name]), CURATOR_CONFIG=str(LOCAL / "curator/config.json"), CURATOR_DATA_DIR=str(LOCAL / "curator/data"), BASE="/curator", PUBLIC_ORIGIN=f"http://localhost:{c['front']}")
            if name != "api":
                # UI processes never receive server secrets.
                service_env = {k: v for k, v in service_env.items() if k not in
                               ("DATABASE_URL", "CLERK_SECRET_KEY", "SESSION_SECRET", "AYAMAI_LOCAL_MEDIA_ROOT")}
            with (LOCAL / (name + ".log")).open("ab") as log:
                process = subprocess.Popen(commands[name], cwd=ROOT, env=service_env, stdout=log, stderr=log, start_new_session=True)
            item = identity(process.pid)
            if item is None:
                raise RuntimeError(f"{name} exited during launch.")
            saved[name] = item
            started.append(name)
            save(saved)
        for _ in range(150):
            if not all(owned(saved[s]) for s in started):
                raise RuntimeError("Service exited; inspect private local logs.")
            try:
                for name in started:
                    path = "/api/healthz" if name in ("api", "web", "curator") else "/index.json"
                    with urllib.request.urlopen(f"http://127.0.0.1:{c[name]}{path}", timeout=1) as response:
                        if response.status != 200:
                            raise OSError("Not ready")
                for name in started:
                    print(f"{name}: http://localhost:{c[name]}")
                if "api" in started:
                    print("Intake worker runs inside API; labeling uses existing API/web. No duplicate worker.")
                return
            except OSError:
                time.sleep(.4)
        raise RuntimeError("Readiness timed out; inspect private local logs.")
    except BaseException:
        stop(started)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("setup", "preflight", "start", "stop", "status", "restart", "logs", "db-start", "db-stop"))
    parser.add_argument("--service", choices=SERVICES)
    parser.add_argument("--agent", action="store_true")
    parser.add_argument("--port-offset", type=int)
    parser.add_argument("--lines", type=int, default=50)
    args = parser.parse_args()
    os.umask(0o077)
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    selected = [args.service] if args.service else list(SERVICES)
    with (LOCAL / "lifecycle.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == "setup":
            setup(args)
            return
        if args.action == "stop":
            stop(selected)
            return
        c = config()
        if args.action == "preflight":
            preflight(c, selected)
        elif args.action in ("start", "restart"):
            if args.action == "restart":
                stop(selected)
            start(c, selected)
        elif args.action == "status":
            saved = state()
            for name in selected:
                print(f"{name}: " + ("running (owned)" if saved.get(name) and owned(saved[name]) else "not managed/running") + f" — localhost:{c[name]}")
            try:
                item = inspect_db(c)
                db_state = "running" if item["State"]["Running"] else "stopped"
            except (subprocess.CalledProcessError, FileNotFoundError):
                db_state = "unavailable"
            print(f"Database: {db_state} — localhost:{c['db']}/{c['database']}")
            print("Intake lifecycle follows API; labeling follows API/web.")
        elif args.action == "logs":
            if not 1 <= args.lines <= 1000:
                fail("--lines must be 1..1000.")
            for name in selected:
                print(f"--- {name} (private local log) ---")
                path = LOCAL / (name + ".log")
                if path.exists():
                    with path.open(errors="replace") as stream:
                        print("".join(collections.deque(stream, maxlen=args.lines)), end="")
        elif args.action == "db-start":
            db_start(c)
        elif args.action == "db-stop":
            if any(owned(i) for i in state().values()):
                fail("Stop managed services before stopping the database.")
            inspect_db(c)
            run(["docker", "stop", c["container"]], stdout=subprocess.DEVNULL)
            print("Database stopped; volume retained.")


if __name__ == "__main__":
    main()
