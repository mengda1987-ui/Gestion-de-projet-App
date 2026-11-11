#!/usr/bin/env python3
"""
用本地 git 凭据 + Supabase 公钥（libsodium sealed box）配置 GitHub Secrets。

GitHub 的 secrets API 要求用仓库公钥做 sealed box 加密，这里用 pynacl 实现。
如果没有 pynacl，会提示安装。
"""
import base64
import json
import subprocess
import sys
import urllib.request

REPO = 'mengda1987-ui/Gestion-de-projet-App'


def get_cred():
    out = subprocess.run(
        ['git', 'credential-osxkeychain', 'get'],
        input='protocol=https\nhost=github.com\n\n',
        capture_output=True, text=True,
    ).stdout
    user = pw = None
    for line in out.splitlines():
        if line.startswith('username='):
            user = line.split('=', 1)[1]
        elif line.startswith('password='):
            pw = line.split('=', 1)[1]
    return user, pw


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


def main():
    try:
        from nacl import encoding, public
    except ImportError:
        print('✗ 需要 pynacl: pip3 install pynacl')
        sys.exit(1)

    user, token = get_cred()
    if not token:
        print('✗ 未取到 git 凭据')
        sys.exit(1)

    # 读取 .env.local
    env = {}
    with open('.env.local') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v.strip().strip('"\'')

    supabase_url = env.get('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not supabase_url or not supabase_key:
        print('✗ .env.local 缺少 Supabase 配置')
        sys.exit(1)

    # 获取仓库公钥
    status, pk = api(f'/repos/{REPO}/actions/secrets/public-key', token)
    if status != 200:
        print(f'✗ 获取公钥失败 ({status}): {pk}')
        print('  可能原因：token 权限不足（需要 repo + workflow 权限）')
        sys.exit(1)

    def seal(value: str) -> str:
        pub = public.PublicKey(pk['key'].encode(), encoding.Base64Encoder())
        box = public.SealedBox(pub)
        return base64.b64encode(box.encrypt(value.encode())).decode()

    for name, value in [
        ('SUPABASE_URL', supabase_url),
        ('SUPABASE_ANON_KEY', supabase_key),
    ]:
        status, resp = api(
            f'/repos/{REPO}/actions/secrets/{name}',
            token,
            method='PUT',
            data={'encrypted_value': seal(value), 'key_id': pk['key_id']},
        )
        if status in (201, 204):
            print(f'✓ 已设置 {name}')
        else:
            print(f'✗ 设置 {name} 失败 ({status}): {resp}')

    # 列出确认
    status, secrets = api(f'/repos/{REPO}/actions/secrets', token)
    if status == 200:
        print('\n当前仓库 Secrets:')
        for s in secrets.get('secrets', []):
            print('  -', s['name'], '更新于', s['updated_at'])


if __name__ == '__main__':
    main()
