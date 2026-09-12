#!/usr/bin/env python
"""Set a new password for an account.

The other half of the "email us and we will reset it" line on the sign-in
page. There is no self-service reset, so without this an administrator has no
way to honour it.

    python scripts/reset_password.py someone@example.com
    python scripts/reset_password.py someone@example.com --list

The password is read from a prompt, never from an argument — anything on the
command line ends up in shell history and in the process list.
"""
from __future__ import annotations

import getpass
import sys

from pongai.core.auth import hash_password, password_problems
from pongai.core.config import load_env


def main() -> int:
    load_env()
    from pongai.core.storage import USER_TABLE, get_storage

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    store = get_storage()

    if "--list" in sys.argv or not args:
        table = store.table_svc.get_table_client(USER_TABLE)
        rows = list(table.list_entities())
        print(f"{len(rows)} account(s):")
        for r in rows:
            print(f"  {r.get('email')}")
        if not args:
            print("\nUsage: python scripts/reset_password.py <email>")
        return 0

    email = args[0]
    user = store.get_user_by_email(email)
    if user is None:
        print(f"No account for {email}.")
        return 1

    print(f"Resetting the password for {user.email} ({user.full_name}).")
    password = getpass.getpass("New password: ")
    if password != getpass.getpass("Repeat: "):
        print("They do not match.")
        return 1

    problems = password_problems(password)
    if problems:
        print("The password must " + ", ".join(problems) + ".")
        return 1

    store.update_user_password(user, hash_password(password))
    print("Done. Existing sessions keep working until their token expires.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
