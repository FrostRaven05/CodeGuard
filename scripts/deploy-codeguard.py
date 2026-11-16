"""Publish built files over SSH, with hash verification and manifest-last ordering.

Requires paramiko. Credentials are prompted, never written to disk.
"""
import argparse
import base64
import getpass
import hashlib
import json
from pathlib import Path
import shlex
import time

import paramiko


def execute(client, command):
    _, output, errors = client.exec_command(command, timeout=600)
    result = output.read().decode()
    error = errors.read().decode()
    if output.channel.recv_exit_status():
        raise RuntimeError(error or result)
    return result.strip()


def publish(client, root, release_dir):
    root, release_dir = Path(root).resolve(), Path(release_dir).resolve()
    version = json.loads((root / 'package.json').read_text())['version']
    setup = f'CodeGuard-{version}-Setup-x64.exe'
    portable = f'CodeGuard-{version}-Portable-x64.exe'
    names = [setup, setup + '.blockmap', portable]
    manifest = (release_dir / 'latest.yml').read_text(encoding='utf-8')
    expected = base64.b64encode(hashlib.sha512((release_dir / setup).read_bytes()).digest()).decode()
    if f'version: {version}\n' not in manifest or setup not in manifest or expected not in manifest:
        raise RuntimeError('Manifest does not match the installer version/hash')
    sums = ''.join(f'{hashlib.sha256((release_dir / name).read_bytes()).hexdigest()}  {name}\n' for name in names)
    sums_name = f'SHA256SUMS-{version}.txt'
    (release_dir / sums_name).write_text(sums, encoding='ascii')
    names.append(sums_name)
    stamp = str(time.time_ns())
    site = f'/opt/codeguard/sites/{version}-{stamp}'
    execute(client, f'mkdir -p {site} /opt/codeguard/updates')
    with client.open_sftp() as transfer:
        def upload(source, destination, immutable=False):
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            if immutable:
                prior = execute(client, f'if test -f {shlex.quote(destination)}; then sha256sum {shlex.quote(destination)}; fi')
                if prior:
                    if prior.split()[0] != digest:
                        raise RuntimeError(f'Published asset cannot be overwritten: {source.name}')
                    return
            temp = destination + '.upload-' + stamp
            transfer.put(str(source), temp)
            actual = execute(client, f'sha256sum {shlex.quote(temp)}').split()[0]
            if actual != digest:
                raise RuntimeError(f'Upload hash mismatch: {source.name}')
            transfer.chmod(temp, 0o644)
            transfer.posix_rename(temp, destination)
            print('Verified', source.name, digest, flush=True)

        for source in sorted((root / 'website/dist').rglob('*')):
            if source.is_file():
                relative = source.relative_to(root / 'website/dist').as_posix()
                destination = site + '/' + relative
                execute(client, 'mkdir -p ' + shlex.quote(destination.rsplit('/', 1)[0]))
                upload(source, destination)
        for name in names:
            upload(release_dir / name, '/opt/codeguard/updates/' + name, immutable=True)
        # All assets are complete before making either the website or feed visible.
        execute(client, f'ln -s {site} /opt/codeguard/site-{stamp} && mv -Tf /opt/codeguard/site-{stamp} /opt/codeguard/site')
        execute(client, f'if test -f /opt/codeguard/updates/latest.yml; then cp /opt/codeguard/updates/latest.yml /opt/codeguard/updates/latest.yml.backup-{stamp}; fi')
        upload(release_dir / 'latest.yml', '/opt/codeguard/updates/latest.yml')
    print('Published', version, 'https://codereview.frostraven05.com', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='codereview.frostraven05.com')
    parser.add_argument('--user', default='root')
    parser.add_argument('--host-key-sha256', required=True, help='Base64 SHA256 host key fingerprint without SHA256:')
    parser.add_argument('--release-dir', required=True)
    args = parser.parse_args()

    class PinnedHost(paramiko.MissingHostKeyPolicy):
        def missing_host_key(self, client, hostname, key):
            actual = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
            if actual != args.host_key_sha256.rstrip('='):
                raise RuntimeError('SSH host key mismatch')

    with paramiko.SSHClient() as client:
        client.set_missing_host_key_policy(PinnedHost())
        client.connect(args.host, username=args.user, password=getpass.getpass('SSH password: '), timeout=20)
        publish(client, Path(__file__).resolve().parent.parent, args.release_dir)
