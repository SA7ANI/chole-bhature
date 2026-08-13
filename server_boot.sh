#!/bin/bash

# Nuvio Server Master Boot Script for Termux
echo "🚀 Booting Nuvio Meta-Sorter Server..."

# Ensure Android does not put the CPU to sleep when screen turns off
echo "🔋 Acquiring Wake Lock..."
termux-wake-lock

# Ensure we are in the right directory
cd "$(dirname "$0")"

# Kill any existing cloudflared or node processes
pkill -f cloudflared
pkill -f node

# Update codebase if any changes exist
echo "📥 Checking for updates from GitHub..."
git pull origin main
npm install

echo "🔄 Starting Cloudflare Tunnel..."
rm -f cloudflared.log
cloudflared tunnel --url http://localhost:7000 > cloudflared.log 2>&1 &

echo "⚙️ Starting Node.js Server Loop..."
while true; do
    echo "🟢 Server starting..."
    node index.js
    echo "🔴 Server crashed or stopped. Restarting in 3 seconds..."
    sleep 3
done
