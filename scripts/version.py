"""Aulo's release number, kept the same in every file that carries it.

  python3 scripts/version.py              show the current number
  python3 scripts/version.py set 0.9.0    change it everywhere (commit it in a pull request)
  python3 scripts/version.py tag          after that pull request is merged: tag main with
                                          v<number> and push the tag, which builds the
                                          macOS and Windows installers
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NUMBER = re.compile(r'^\d+\.\d+\.\d+$')

# Each file, with the pattern of the line(s) holding Aulo's own number and how many.
FILES = [
    ('package.json', r'^(  "version": ")[^"]+(")', 1),
    ('package-lock.json', r'^(  (?:    )?"version": ")[^"]+(")', 2),
    ('src-tauri/tauri.conf.json', r'^(  "version": ")[^"]+(")', 1),
    ('src-tauri/Cargo.toml', r'^(version = ")[^"]+(")', 1),
    ('src-tauri/Cargo.lock', r'^(name = "aulo"\nversion = ")[^"]+(")', 1),
]


def current():
    return json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


def set_number(number):
    if not NUMBER.match(number):
        sys.exit(f'Expected a number like 0.9.0, got {number!r}.')
    for name, pattern, count in FILES:
        path = ROOT / name
        text = path.read_text(encoding='utf-8')
        text, found = re.subn(pattern, rf'\g<1>{number}\g<2>', text, count=count, flags=re.M)
        if found != count:
            sys.exit(f'{name}: expected {count} version line(s), found {found}.')
        path.write_text(text, encoding='utf-8')
    print(f'Aulo is now {number}. Commit these files in a pull request, merge it, then run:')
    print('  python3 scripts/version.py tag')


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, check=True, text=True,
                          capture_output=True).stdout.strip()


def tag():
    number = current()
    name = f'v{number}'
    if git('rev-parse', '--abbrev-ref', 'HEAD') != 'main':
        sys.exit('Switch to main first: releases are tagged on main.')
    if git('status', '--porcelain', '--untracked-files=no'):
        sys.exit('main has uncommitted changes; commit or discard them first.')
    git('fetch', '--quiet', '--tags', 'origin', 'main')
    if git('rev-parse', 'HEAD') != git('rev-parse', 'origin/main'):
        sys.exit('This main is not the same as GitHub\'s; run git pull first.')
    if git('tag', '--list', name):
        sys.exit(f'{name} already exists. Change the number with "set" first.')
    git('tag', '-a', name, '-m', f'Aulo {number}')
    git('push', 'origin', name)
    print(f'Tagged {name} on {git("rev-parse", "--short=7", "HEAD")} and pushed it.')
    print('The macOS and Windows installers are now building on GitHub (Actions).')


if __name__ == '__main__':
    match sys.argv[1:]:
        case []:
            print(current())
        case ['set', number]:
            set_number(number)
        case ['tag']:
            tag()
        case _:
            sys.exit(__doc__)
