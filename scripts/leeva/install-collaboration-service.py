#!/usr/bin/env python3
"""Install only the loopback rule-storage service. Does not enable Grok scheduling."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
from datetime import datetime

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--apply", action="store_true")
args = parser.parse_args()
if sys.platform != "darwin":
    raise SystemExit("This installer is for macOS; run collaboration_rules.py serve on other systems.")
script = Path(__file__).resolve().with_name("collaboration_rules.py")
label = "com.leeva.paperclip-rules"
target = Path.home() / "Library" / "LaunchAgents" / (label + ".plist")
logs = Path.home() / ".paperclip" / "leeva" / "logs"
config = {"Label": label, "ProgramArguments": [sys.executable, str(script), "serve", "--port", "3103"],
          "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 10,
          "StandardOutPath": str(logs / "collaboration-rules.out.log"),
          "StandardErrorPath": str(logs / "collaboration-rules.err.log")}
print("LaunchAgent: " + str(target))
print("Rule service: 127.0.0.1:3103 (storage and route lookup only; no scheduler or model execution)")
if not args.apply:
    print("Dry run. Pass --apply to install/update this one LaunchAgent.")
    raise SystemExit(0)
logs.mkdir(parents=True, exist_ok=True)
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    backup = target.with_suffix(".plist.backup-" + datetime.now().strftime("%Y%m%dT%H%M%S"))
    shutil.copy2(target, backup)
    print("Backup: " + str(backup))
with target.open("wb") as stream:
    plistlib.dump(config, stream)
domain = "gui/" + str(os.getuid())
subprocess.run(["launchctl", "bootout", domain + "/" + label], capture_output=True)
subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
print("Installed. Grok routines and Paperclip agents were not modified.")
