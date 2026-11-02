"""Run Curator tests only in a new synthetic database in the verified owned container."""
import importlib.util
import pathlib
import subprocess
import uuid
spec = importlib.util.spec_from_file_location('local_dev', pathlib.Path(__file__).parents[1] / 'local-dev.py')
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)
c = dev.config()
dev.inspect_db(c)
target = dict(c, database='curator_test_' + uuid.uuid4().hex)
dev.db_sql(c, 'CREATE DATABASE "' + target['database'] + '";')
dev.bootstrap_schema(target)
# Only generated credentials for this task-owned database enter the child process.
env = dev.clean_environment()
for line in (dev.LOCAL/'runtime.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        url=line.split('=',1)[1]
        env['DATABASE_URL']=url.rsplit('/',1)[0]+'/'+target['database']
env.update(NODE_ENV='test', AYAMAI_DEV_AUTH_MODE='clerk', CLERK_PUBLISHABLE_KEY='pk_test_Y2xlcmsuZXhhbXBsZS5pbnZhbGlkJA', CLERK_SECRET_KEY='sk_test_ci_placeholder', SESSION_SECRET='synthetic-curator-regression-only-secret')
subprocess.run(['pnpm','test:curator-api'],cwd=dev.ROOT,env=env,check=True)
for suite in ('test:founder-access','test:imports','test:label-datasets'):
    subprocess.run(['pnpm',suite],cwd=dev.ROOT,env=env,check=True)
print('Curator synthetic API suite passed; disposable database retained, no shared DB changed.')
