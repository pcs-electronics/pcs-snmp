# OID = txAlarmCodeLatched
OID=1.3.6.1.4.1.65081.1.4.4.0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/snmp_target.sh"

# Read current latched alarm code
snmpget -v2c -c public  $IP $OID

# Reset latched alarm code to 0
snmpset -v2c -c private $IP $OID i 0
snmpget -v2c -c public  $IP $OID
