# OID = txPowerPercent
OID=1.3.6.1.4.1.65081.1.2.3.0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/snmp_target.sh"

# Read current power setting
snmpget -v2c -c public  $IP $OID

# Set power to 50%
snmpset -v2c -c private $IP $OID i 50
snmpget -v2c -c public  $IP $OID
