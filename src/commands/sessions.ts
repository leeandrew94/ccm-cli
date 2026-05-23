import { getSessionsList, deleteSession, deleteAllSessions, restoreSession, getTrashSessions, purgeTrash, cleanupOldTrash, type SessionSummary } from '../session-data.js';
import { startSessionServer } from '../session-server.js';
import { ok, err, warn } from '../output.js';

const PAGE_SIZE = 10;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function printTable(sessions: SessionSummary[], page: number, selectedIndex: number): void {
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, sessions.length);
  const pageSessions = sessions.slice(start, end);

  console.clear();
  console.log();
  console.log('  \x1b[1mccm sessions\x1b[0m  (↑↓ 选择 | Enter Web查看 | d 删除 | D 清空全部 | q 退出)');
  console.log();

  if (sessions.length === 0) {
    console.log('  暂无会话记录');
    console.log();
    return;
  }

  const totalW = process.stdout.columns || 80;
  const timeW = 12;
  const gap = 2; // space between columns
  const prefixW = 4; // "  ▶ " or "    "
  const availW = totalW - prefixW - timeW - gap * 2;

  // Calculate project column width based on longest folder name in current page
  let maxProjLen = 4; // minimum: "项目".length
  for (const s of pageSessions) {
    if (s.projectName.length > maxProjLen) maxProjLen = s.projectName.length;
  }
  const projW = maxProjLen + 2; // small padding
  const questionW = Math.max(10, availW - projW);

  // Header
  console.log(
    ' '.repeat(prefixW) +
    '\x1b[2m' +
    '时间'.padEnd(timeW) + ' '.repeat(gap) +
    '项目'.padEnd(projW) + ' '.repeat(gap) +
    '首条提问' +
    '\x1b[0m'
  );
  console.log(' '.repeat(prefixW) + '\x1b[2m' + '─'.repeat(Math.min(totalW - prefixW, 80)) + '\x1b[0m');

  // Rows
  for (let i = 0; i < pageSessions.length; i++) {
    const s = pageSessions[i];
    const globalIdx = start + i;
    const isSelected = globalIdx === selectedIndex;
    const prefix = isSelected ? '  \x1b[36m▶ ' : '    ';
    const suffix = isSelected ? '\x1b[0m' : '';

    const time = formatTime(s.timestamp);
    const proj = truncate(s.projectName, projW);
    const question = truncate(s.firstQuestion, questionW);

    console.log(
      prefix +
      time.padEnd(timeW) + ' '.repeat(gap) +
      proj.padEnd(projW) + ' '.repeat(gap) +
      question +
      suffix
    );
  }

  // Pagination
  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
  if (totalPages > 1) {
    console.log();
    console.log(
      '\x1b[2m' +
      `  第 ${page + 1}/${totalPages} 页 (共 ${sessions.length} 个会话, ← → 翻页)` +
      '\x1b[0m'
    );
  }
}

async function confirmPrompt(msg: string): Promise<boolean> {
  process.stdout.write(`\n  ${msg} (y/N) `);
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim().toLowerCase() === 'y');
    });
  });
}

export async function cmdSessions(args: { web?: boolean; restore?: string; purge?: boolean }): Promise<void> {
  // Auto-cleanup old trash (30 days)
  cleanupOldTrash();

  if (args.purge) {
    const trash = getTrashSessions();
    if (trash.length === 0) {
      console.log('\n  回收站为空\n');
      return;
    }
    console.log(`\n  回收站中有 ${trash.length} 个会话`);
    const confirmed = await confirmPrompt('\x1b[31m确认清空回收站？此操作不可恢复！\x1b[0m');
    if (confirmed) {
      purgeTrash();
      ok('回收站已清空');
    }
    console.log();
    return;
  }

  if (args.restore !== undefined) {
    if (args.restore === '') {
      // Restore most recent
      const trash = getTrashSessions();
      if (trash.length === 0) {
        console.log('\n  回收站为空\n');
        return;
      }
      const latest = trash[0];
      const confirmed = await confirmPrompt(`恢复会话 "${latest.sessionId.slice(0, 8)}..."？`);
      if (confirmed) {
        restoreSession(latest.sessionId);
        ok('会话已恢复');
      }
    } else {
      const success = restoreSession(args.restore);
      if (success) {
        ok('会话已恢复');
      } else {
        err(`未找到会话 ${args.restore}`);
      }
    }
    console.log();
    return;
  }

  if (args.web) {
    await startSessionServer();
    return;
  }

  const sessions = getSessionsList();

  if (sessions.length === 0) {
    console.log('\n  暂无会话记录\n');
    return;
  }

  let selectedIndex = 0;
  let page = 0;
  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);

  // Set up raw stdin
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const cleanup = () => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  };

  printTable(sessions, page, selectedIndex);

  return new Promise<void>((resolve) => {
    process.stdin.on('data', async (key: string) => {
      // Ctrl+C or q
      if (key === '\x03' || key === 'q') {
        cleanup();
        console.log();
        resolve();
        return;
      }

      // Up arrow
      if (key === '\x1b[A') {
        if (selectedIndex > 0) {
          selectedIndex--;
          // Adjust page if needed
          if (selectedIndex < page * PAGE_SIZE) {
            page = Math.floor(selectedIndex / PAGE_SIZE);
          }
          printTable(sessions, page, selectedIndex);
        }
        return;
      }

      // Down arrow
      if (key === '\x1b[B') {
        if (selectedIndex < sessions.length - 1) {
          selectedIndex++;
          if (selectedIndex >= (page + 1) * PAGE_SIZE) {
            page = Math.floor(selectedIndex / PAGE_SIZE);
          }
          printTable(sessions, page, selectedIndex);
        }
        return;
      }

      // Left arrow - previous page
      if (key === '\x1b[D') {
        if (page > 0) {
          page--;
          selectedIndex = page * PAGE_SIZE;
          printTable(sessions, page, selectedIndex);
        }
        return;
      }

      // Right arrow - next page
      if (key === '\x1b[C') {
        if (page < totalPages - 1) {
          page++;
          selectedIndex = page * PAGE_SIZE;
          printTable(sessions, page, selectedIndex);
        }
        return;
      }

      // Enter - open web
      if (key === '\r' || key === '\n') {
        cleanup();
        const session = sessions[selectedIndex];
        if (session) {
          console.log();
          await startSessionServer();
        }
        resolve();
        return;
      }

      // d - delete single
      if (key === 'd') {
        cleanup();
        const session = sessions[selectedIndex];
        if (session) {
          const confirmed = await confirmPrompt(`确认删除 "${truncate(session.firstQuestion, 30)}"？(移入回收站)`);
          if (confirmed) {
            deleteSession(session.sessionId);
            sessions.splice(selectedIndex, 1);
            if (selectedIndex >= sessions.length) selectedIndex = Math.max(0, sessions.length - 1);
            ok('已移入回收站 (ccm sessions --restore 恢复)');
          }
        }
        // Re-enable raw mode
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        printTable(sessions, page, selectedIndex);
        return;
      }

      // D - delete all
      if (key === 'D') {
        cleanup();
        const confirmed = await confirmPrompt('\x1b[33m确认清空全部会话？(移入回收站，30天后自动清理)\x1b[0m');
        if (confirmed) {
          deleteAllSessions();
          sessions.length = 0;
          ok('全部会话已移入回收站');
        }
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        printTable(sessions, page, selectedIndex);
        return;
      }
    });
  });
}
