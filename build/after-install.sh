#!/bin/bash
# Fix SUID permissions for chrome-sandbox on Linux
chown root:root /opt/ZenNotes/chrome-sandbox
chmod 4755 /opt/ZenNotes/chrome-sandbox
