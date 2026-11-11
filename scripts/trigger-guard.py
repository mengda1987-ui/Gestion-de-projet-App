#!/usr/bin/env python3
"""手动触发 Data Guard Backup workflow 并等待结果"""
import json
import subprocess
import sys
import time
import urllib.request

REPO = 'mengda1987-ui/Gestion-de-projet-App'


def get_token():
    out = subprocess.run(
        ['git', 'credential-osxkeychain', 'get'],
        input='protocol=https\nhost=github.com\n\n',
        capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    return None


def api(path, token, method='GET', data=None):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        method=method,
        data=json.dumps(data).encode() if data else None,
        headers={
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


token = get_token()
if not token:
    print('✗ 无凭据')
    sys.exit(1)

# 触发
status, resp = api(
    f'/repos/{REPO}/actions/workflows/data-guard.yml/dispatches',
    token, method='POST', data={'ref': 'main'},
)
print(f'触发 workflow: HTTP {status}')
if status not in (204, 201):
    print(resp)
    sys.exit(1)

# 等新 run 出现
run_id = None
for _ in range(20):
    time.sleep(4)
    s, runs = api(f'/repos/{REPO}/actions/runs?per_page=1', token)
    if s == 200 and runs.get('workflow_runs'):
        run_id = runs['workflow_runs'][0]['id']
        print(f'新运行 ID: {run_id}')
        break

if not run_id:
    print('未找到新运行')
    sys.exit(1)

# 轮询结果
for i in range(40):
    time.sleep(8)
    s, run = api(f'/repos/{REPO}/actions/runs/{run_id}', token)
    st, cc = run.get('status'), run.get('conclusion')
    print(f'  [{i+1}] {st} / {cc}')
    if st == 'completed':
        break

s, jobs = api(f'/repos/{REPO}/actions/runs/{run_id}/jobs', token)
if s == 200:
    for j in jobs.get('jobs', []):
        print(f"\nJob: {j['name']} → {j['conclusion']}")
        for step in j.get('steps', []):
            print(f"   {step['number']}. {step['name']}: {step['conclusion']}")
