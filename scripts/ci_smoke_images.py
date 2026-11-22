"""Smoke isolated CI images without models, datasets, ports or remote access.

This does not validate real inference. It verifies honest unavailable-model
readiness, the packaged public metadata and the public frontend runtime URL.
Only containers created by this process are removed during cleanup.
"""

import argparse
import json
import subprocess
import time

API_PROBE = """
import json, urllib.request, urllib.error
from pathlib import Path
base='http://127.0.0.1:8000'
health=json.load(urllib.request.urlopen(base+'/health',timeout=5))
assert health['models_loaded'] is False
assert all(value is False for value in health['models'].values())
try:
    urllib.request.urlopen(base+'/ready',timeout=5)
    raise AssertionError('Missing models must not be Ready')
except urllib.error.HTTPError as error:
    assert error.code==503
data=json.load(urllib.request.urlopen(base+'/dashboard',timeout=5))
assert data['metadata']['snapshot']['status']=='valid'
assert len(data['evaluations'])==4 and all(row['status']=='available' for row in data['evaluations'])
assert len(data['datasets'])==7 and all(not row['local_available'] for row in data['datasets'])
assert len(data['mlops']['mlflow']['registry'])==4
assert len(data['mlops']['training_runs'])==5
assert data['mlops']['ci']['execution_status']=='not_checked'
assert data['mlops']['dvc']['remote_accessible'] is None
assert data['mlops']['dvc']['artifacts_synchronized'] is None
assert all(not row['available'] for row in data['mlops']['checkpoints'])
assert all(not (Path('/app')/p).exists() for p in ['mlflow.db','mlruns','.dvc/config','.dvc/config.local','data/raw'])
print(json.dumps({'health':200,'ready':503,'snapshot':data['metadata']['snapshot']['status'],
 'recorded_evaluations':4,'recorded_datasets':7,'recorded_registry_versions':4,
 'recorded_csv_summaries':5,'real_inference':'NOT EXERCISED (weights absent by design)'}))
"""

FRONTEND_PROBE = """
Promise.all([fetch('http://127.0.0.1:8081/'),fetch('http://127.0.0.1:8081/solarvision-config.js')]).then(async ([page,config])=>{
 if(page.status!==200||config.status!==200)throw new Error('Frontend not ready');
 const text=await config.text();
 if(!text.includes('http://127.0.0.1:18000'))throw new Error('Runtime browser URL missing');
 if(!config.headers.get('cache-control')?.includes('no-store'))throw new Error('Runtime config is cacheable');
 console.log(JSON.stringify({frontend:page.status,public_runtime_config:config.status,browser_api_url:'http://127.0.0.1:18000'}));
}).catch(error=>{console.error(error.message);process.exitCode=1});
"""


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def wait_probe(container, executable, code, seconds):
    deadline = time.monotonic() + seconds
    latest = None
    while time.monotonic() < deadline:
        result = docker("exec", container, executable, "-c" if executable == "python" else "-e", code, check=False)
        if result.returncode == 0:
            return json.loads(result.stdout.strip())
        latest = result.stderr.strip() or result.stdout.strip()
        state = json.loads(docker("inspect", container).stdout)[0]["State"]
        if not state["Running"]:
            break
        time.sleep(.5)
    raise RuntimeError("Isolated image smoke failed: " + str(latest))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-image", default="solarvision-api:ci")
    parser.add_argument("--frontend-image", default="solarvision-frontend:ci")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    created = []
    try:
        api = docker("run", "-d", "--pull=never", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,mode=1777", "--tmpfs", "/app/storage:rw,mode=1777",
                     "--env", "YOLO_OFFLINE=true", "--env", "HF_HUB_OFFLINE=1", args.api_image).stdout.strip()
        created.append(api)
        frontend = docker("run", "-d", "--pull=never", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,mode=1777",
                          "--env", "SOLARVISION_PUBLIC_API_BASE_URL=http://127.0.0.1:18000", args.frontend_image).stdout.strip()
        created.append(frontend)
        result = {"api": wait_probe(api, "python", API_PROBE, args.timeout),
                  "frontend": wait_probe(frontend, "node", FRONTEND_PROBE, args.timeout),
                  "isolation": "no network, published ports, host mounts, datasets or model weights"}
        print(json.dumps(result, indent=2))
        return 0
    except Exception:
        for container in created:
            print(docker("logs", container, check=False).stdout)
        raise
    finally:
        for container in created:
            docker("rm", "-f", container, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
