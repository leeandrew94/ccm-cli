import { loadProfiles } from './config.js';

const COMMANDS = ['init', 'add', 'edit', 'rm', 'list', 'ls', 'ps', 'kill', 'check', 'test', 'balance', 'bal', 'config', 'completions', 'sessions'];

export function cmdCompletions(args: { shell?: string }): void {
  const shell = args.shell || detectShell();

  if (shell === 'zsh') {
    console.log(ZSH_COMPLETION);
  } else if (shell === 'bash') {
    console.log(BASH_COMPLETION);
  } else {
    console.error(`Unsupported shell: ${shell}. Use 'bash' or 'zsh'.`);
    process.exit(1);
  }
}

function detectShell(): string {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  return 'zsh';
}

const ZSH_COMPLETION = `#compdef ccm

_ccm() {
  local -a commands profiles
  commands=(${COMMANDS.join(' ')})
  profiles=("\${(@f)$(ccm list 2>/dev/null | grep -E '^\\s*│' | grep -v 'PROFILE' | grep -v '─' | awk '{print $2}')}")
  _arguments "1: :(\${commands} \${profiles})" "2: :(\${profiles})"
}

_ccm "$@"`;

const BASH_COMPLETION = `_ccm_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "\$COMP_CWORD" -eq 1 ]; then
    local commands="${COMMANDS.join(' ')}"
    local profiles
    profiles=$(ccm list 2>/dev/null | grep -E '^\\s*│' | grep -v 'PROFILE' | grep -v '─' | awk '{print $2}' | tr '\\n' ' ')
    COMPREPLY=(\$(compgen -W "\$commands \$profiles" -- "\$cur"))
  elif [ "\$COMP_CWORD" -eq 2 ]; then
    case "\$prev" in
      edit|rm|kill)
        local profiles
        profiles=$(ccm list 2>/dev/null | grep -E '^\\s*│' | grep -v 'PROFILE' | grep -v '─' | awk '{print $2}' | tr '\\n' ' ')
        COMPREPLY=(\$(compgen -W "\$profiles" -- "\$cur"))
        ;;
    esac
  fi
}

complete -F _ccm_completions ccm`;
