"""Évolution quotidienne et hebdomadaire des comptes et des candidatures."""

from collections import Counter
from datetime import date, timedelta


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _table(accounts: list[date], applications: list[date], days: list[date], period) -> list[dict]:
    new_accounts, new_applications = Counter(map(period, accounts)), Counter(map(period, applications))
    rows, total_accounts, total_applications = [], 0, 0
    for start in sorted({period(d) for d in days}):
        total_accounts += new_accounts[start]
        total_applications += new_applications[start]
        rows.append({"period": start.isoformat(),
                     "accounts": new_accounts[start], "totalAccounts": total_accounts,
                     "applications": new_applications[start], "totalApplications": total_applications})
    return rows[::-1]


def evolution(account_dates: list[str], application_dates: list[str], today: date) -> dict:
    """Une ligne par jour et par semaine (lundi), du premier enregistrement à aujourd'hui, la plus récente d'abord."""
    accounts = [date.fromisoformat(d[:10]) for d in account_dates]
    applications = [date.fromisoformat(d[:10]) for d in application_dates]
    if not accounts and not applications:
        return {"daily": [], "weekly": []}
    first = min(accounts + applications)
    days = [first + timedelta(days=n) for n in range((today - first).days + 1)]
    return {"daily": _table(accounts, applications, days, lambda d: d),
            "weekly": _table(accounts, applications, days, _monday)}
