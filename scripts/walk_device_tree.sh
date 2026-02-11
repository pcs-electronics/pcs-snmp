#!/usr/bin/env bash

# Walk PCS Electronics enterprise subtree
OID=1.3.6.1.4.1.65081
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/snmp_target.sh"

snmpwalk -v2c -c public "$IP" "$OID"
