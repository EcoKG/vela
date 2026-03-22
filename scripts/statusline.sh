#!/bin/bash
# ⛵ Vela Status Line — shows pipeline state in Claude Code's bottom bar
# Receives JSON session data via stdin from Claude Code
# Works without jq — uses node for JSON parsing

input=$(cat)

# Parse JSON with node (always available since Vela requires Node.js)
eval $(echo "$input" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const m=j.model?.display_name||'unknown';
      const p=Math.round(j.context_window?.used_percentage||0);
      const c=j.workspace?.current_dir||'.';
      console.log('MODEL=\"'+m+'\"');
      console.log('PCT=\"'+p+'\"');
      console.log('CWD=\"'+c+'\"');
    }catch(e){
      console.log('MODEL=\"unknown\"');
      console.log('PCT=\"0\"');
      console.log('CWD=\".\"');
    }
  });
" 2>/dev/null) || { echo "⛵ Vela"; exit 0; }

# Find .vela directory
VELA_DIR=""
if [ -d "$CWD/.vela" ]; then
  VELA_DIR="$CWD/.vela"
elif [ -d ".vela" ]; then
  VELA_DIR=".vela"
fi

if [ -z "$VELA_DIR" ]; then
  echo "$MODEL | ${PCT}% ctx"
  exit 0
fi

# Find active pipeline using node
RESULT=$(node -e "
  const fs=require('fs'),path=require('path');
  const ad=path.join('$VELA_DIR','artifacts');
  if(!fs.existsSync(ad)){console.log('none|||0|0');process.exit(0);}
  const dates=fs.readdirSync(ad).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for(const dd of dates){
    const dp=path.join(ad,dd);
    const slugs=fs.readdirSync(dp).filter(d=>{try{return fs.statSync(path.join(dp,d)).isDirectory()}catch{return false}}).sort().reverse();
    for(const s of slugs){
      const sp=path.join(dp,s,'pipeline-state.json');
      if(!fs.existsSync(sp))continue;
      try{
        const st=JSON.parse(fs.readFileSync(sp,'utf-8'));
        if(st.status==='active'){
          const req=(st.request||'').substring(0,25);
          console.log(st.pipeline_type+'|'+st.current_step+'|'+req+'|'+(st.current_step_index||0)+'|'+(st.steps?.length||0));
          process.exit(0);
        }
      }catch{}
    }
  }
  console.log('none|||0|0');
" 2>/dev/null) || RESULT="none|||0|0"

IFS='|' read -r PTYPE STEP REQ SIDX TOTAL <<< "$RESULT"

# Build progress bar
progress_bar() {
  local c=$1 t=$2 w=8
  [ "$t" -gt 0 ] 2>/dev/null || return
  local f=$(( (c * w) / t ))
  local e=$(( w - f ))
  printf "["
  for i in $(seq 1 $f); do printf "="; done
  if [ $f -lt $w ]; then printf ">"; e=$((e - 1)); fi
  for i in $(seq 1 $e); do printf "-"; done
  printf "] %d/%d" "$((c + 1))" "$t"
}

if [ "$PTYPE" != "none" ] && [ -n "$STEP" ]; then
  PROGRESS=$(progress_bar "$SIDX" "$TOTAL")
  echo -e "⛵ Vela ✦ \033[32m${PTYPE}\033[0m 🧭 ${STEP} ${PROGRESS} │ ${REQ}… │ ${PCT}%"
else
  echo -e "⛵ Vela ✦ Explore │ $MODEL ${PCT}%"
fi
