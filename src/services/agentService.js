const generateAgentScript = (baseUrl, serverId, authToken) => {
    return `#!/bin/bash
  
  if [[ "$EUID" -ne 0 ]]; then
      echo '{"success":false,"error":"This script needs to be run with superuser privileges."}'
      exit 1
  fi
  
  CONTROL_PLANE_URL="${baseUrl}"
  SERVER_ID="${serverId}"
  AUTH_TOKEN="${authToken}"
  SCRIPT_DIR="/etc/openvpn/server/clients"
  POLL_INTERVAL="60"
  
  mkdir -p "$SCRIPT_DIR"
  
  if [[ ! -e /etc/openvpn/server/server.conf ]]; then
      echo '{"success":false,"error":"OpenVPN server is not installed."}'
      exit 1
  fi
  
  if grep -qs "ubuntu" /etc/os-release; then
      group_name="nogroup"
  elif [[ -e /etc/debian_version ]]; then
      group_name="nogroup"
  else
      group_name="nobody"
  fi
  
  log_message() {
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> /var/log/openvpn-agent.log
  }
  
  create_client() {
    local client_name=$1
    local password=$2
  
    client=$(sed 's/[^0123456789a-zA-Z_-]/_/g' <<< "$client_name")
  
    if [[ -z "$client" ]]; then
      echo '{"success":false,"error":"Invalid client name"}'
      return 1
    fi
  
    if [[ -e /etc/openvpn/server/easy-rsa/pki/issued/"$client".crt ]]; then
      echo '{"success":false,"error":"Client already exists"}'
      return 1
    fi
  
    cd /etc/openvpn/server/easy-rsa/
  
    if [[ -n "$password" ]]; then
      echo "$password" | ./easyrsa --batch --days=3650 --passout=stdin build-client-full "$client" >/dev/null 2>&1
    else
      ./easyrsa --batch --days=3650 build-client-full "$client" nopass >/dev/null 2>&1
    fi
  
    if [[ $? -ne 0 ]]; then
      echo '{"success":false,"error":"Failed to create client certificate"}'
      return 1
    fi
  
    OVPN_FILE="$SCRIPT_DIR/$client.ovpn"
    cp /etc/openvpn/server/client-common.txt "$OVPN_FILE"
    echo "" >> "$OVPN_FILE"
    echo "<ca>" >> "$OVPN_FILE"
    cat /etc/openvpn/server/easy-rsa/pki/ca.crt >> "$OVPN_FILE"
    echo "</ca>" >> "$OVPN_FILE"
    echo "<cert>" >> "$OVPN_FILE"
    awk '/BEGIN/,/END/' /etc/openvpn/server/easy-rsa/pki/issued/"$client".crt >> "$OVPN_FILE"
    echo "</cert>" >> "$OVPN_FILE"
    echo "<key>" >> "$OVPN_FILE"
    awk '/BEGIN/,/END/' /etc/openvpn/server/easy-rsa/pki/private/"$client".key >> "$OVPN_FILE"
    echo "</key>" >> "$OVPN_FILE"
    echo "<tls-crypt>" >> "$OVPN_FILE"
    cat /etc/openvpn/server/tc.key >> "$OVPN_FILE"
    echo "</tls-crypt>" >> "$OVPN_FILE"
  
    config_content=$(base64 -w 0 "$OVPN_FILE")
    echo "{\\"success\\":true,\\"client\\":\\"$client\\",\\"config\\":\\"$config_content\\",\\"server_id\\":\\"$SERVER_ID\\"}"
    log_message "Created client: $client"
  }
  
  revoke_client() {
      local client_name=$1
      
      client=$(sed 's/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/_/g' <<< "$client_name")
      
      if [[ -z "$client" ]]; then
          echo '{"success":false,"error":"Invalid client name"}'
          return 1
      fi
      
      if [[ ! -e /etc/openvpn/server/easy-rsa/pki/issued/"$client".crt ]]; then
          echo '{"success":false,"error":"Client does not exist"}'
          return 1
      fi
      
      cd /etc/openvpn/server/easy-rsa/
      ./easyrsa --batch revoke "$client" >/dev/null 2>&1
      ./easyrsa --batch --days=3650 gen-crl >/dev/null 2>&1
      rm -f /etc/openvpn/server/crl.pem
      rm -f /etc/openvpn/server/easy-rsa/pki/reqs/"$client".req
      rm -f /etc/openvpn/server/easy-rsa/pki/private/"$client".key
      rm -f "$SCRIPT_DIR"/"$client".ovpn
      cp /etc/openvpn/server/easy-rsa/pki/crl.pem /etc/openvpn/server/crl.pem
      chown nobody:"$group_name" /etc/openvpn/server/crl.pem
      
      if [[ $? -eq 0 ]]; then
          echo "{\\"success\\":true,\\"client\\":\\"$client\\",\\"server_id\\":\\"$SERVER_ID\\"}"
          log_message "Revoked client: $client"
      else
          echo '{"success":false,"error":"Failed to revoke client"}'
          return 1
      fi
  }
  
  poll_tasks() {
      while true; do
          response=$(curl -s -X GET "$CONTROL_PLANE_URL/api/servers/tasks" \
              -H "Authorization: Bearer $AUTH_TOKEN" \
              -m 65)
          
          if [[ -n "$response" ]] && [[ "$response" != "null" ]]; then
              task_id=$(echo "$response" | jq -r '.task_id // empty')
              action=$(echo "$response" | jq -r '.action // empty')
              client_name=$(echo "$response" | jq -r '.client_name // empty')
              password=$(echo "$response" | jq -r '.password // empty')
              
              if [[ -n "$task_id" && -n "$action" ]]; then
                  log_message "Processing task: $task_id - $action - $client_name"
                  
                  case "$action" in
                      create)
                          if [[ "$password" == "null" || -z "$password" ]]; then
                              result=$(create_client "$client_name")
                          else
                              result=$(create_client "$client_name" "$password")
                          fi
                          ;;
                      revoke)
                          result=$(revoke_client "$client_name")
                          ;;
                      *)
                          result='{"success":false,"error":"Invalid action"}'
                          ;;
                  esac
                  
                  curl -s -X POST "$CONTROL_PLANE_URL/api/servers/tasks/$task_id/result" \
                      -H "Content-Type: application/json" \
                      -H "Authorization: Bearer $AUTH_TOKEN" \
                      -d "$result" > /dev/null
              fi
          fi
      done
  }
  
  log_message "Starting daemon mode"
  poll_tasks
  `;
  };
  
  const generateServiceFile = () => {
    return `[Unit]
  Description=OpenVPN Management Agent - tegarsantosa.com
  After=network-online.target openvpn-server@server.service
  Wants=network-online.target
  
  [Service]
  Type=simple
  User=root
  ExecStart=/usr/local/bin/openvpn-agent.sh
  Restart=always
  RestartSec=10
  StandardOutput=journal
  StandardError=journal
  
  [Install]
  WantedBy=multi-user.target
  `;
  };
  
  module.exports = {
    generateAgentScript,
    generateServiceFile,
  };