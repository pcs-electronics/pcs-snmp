# OID = txAudioGain
OID=1.3.6.1.4.1.65081.1.7.2.0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/snmp_target.sh"

# Read current gain
snmpget -v2c -c public  $IP $OID

# Set audio gain to 10 dB
snmpset -v2c -c private $IP $OID i 10
snmpget -v2c -c public  $IP $OID
