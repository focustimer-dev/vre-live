"""Compare VRE Live with a downloaded VRE google_transit.zip, without changing either."""
import argparse
import csv
import io
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def feed_rows(archive, name):
    with archive.open(name) as stream:
        return list(csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig")))


def feed_calendar(path):
    with ZipFile(path) as archive:
        trips = feed_rows(archive, "trips.txt")
        calendars = feed_rows(archive, "calendar.txt")
        exceptions = feed_rows(archive, "calendar_dates.txt")
    dates = {}
    for calendar in calendars:
        start = datetime.strptime(calendar["start_date"], "%Y%m%d").date()
        end = datetime.strptime(calendar["end_date"], "%Y%m%d").date()
        for offset in range((end - start).days + 1):
            day = start + timedelta(days=offset)
            active = dates.setdefault(day.strftime("%Y%m%d"), set())
            if calendar[WEEKDAYS[day.weekday()]] == "1":
                active.add(calendar["service_id"])
    for row in exceptions:
        if row["date"] in dates:
            active = dates[row["date"]]
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            elif row["exception_type"] == "2":
                active.discard(row["service_id"])
    return dates, trips


def app_schedule():
    root = Path(__file__).resolve().parents[1]
    source = """
import './src/monitor-core.js';
const { trips, sTrains, noService, reducedService } = globalThis.VRECore.SCHEDULE;
console.log(JSON.stringify({ trains: trips.map(t => t.num), sTrains: [...sTrains], noService, reducedService }));
"""
    return json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e", source], cwd=root, text=True
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path, help="VRE static GTFS archive")
    args = parser.parse_args()
    dates, trips = feed_calendar(args.zip)
    app = app_schedule()
    for date, active in sorted(dates.items()):
        expected = set()
        day = datetime.strptime(date, "%Y%m%d")
        if day.weekday() < 5 and date not in app["noService"]:
            expected = set(app["sTrains"] if date in app["reducedService"] else app["trains"])
        published = {trip["trip_short_name"] for trip in trips if trip["service_id"] in active}
        if expected != published:
            print(f"{date}  app only: {', '.join(sorted(expected - published)) or '—'}"
                  f"  |  feed only: {', '.join(sorted(published - expected)) or '—'}")
    print("Differences are for review against https://www.vre.org/schedule/.")


if __name__ == "__main__":
    main()
