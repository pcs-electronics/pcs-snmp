# OID = txAudioInputSource
OID=1.3.6.1.4.1.65081.1.7.1.0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/snmp_target.sh"

# Read current source
snmpget -v2c -c public  $IP $OID

# Set to AES/EBU (1)
snmpset -v2c -c private $IP $OID i 1
snmpget -v2c -c public  $IP $OID
