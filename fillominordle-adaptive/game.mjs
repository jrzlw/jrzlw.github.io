import { AdaptiveFillomino, InvalidGuessError, enumerateBoards, validateBoard } from './engine.mjs';

const STORAGE_KEY = 'fillominordle-adaptive-v1';
const $ = id => document.getElementById(id);
const inputBoard = $('inputBoard');
const keypad = $('keypad');
const historyList = $('historyList');
const message = $('message');
const helpDialog = $('helpDialog');
let game = restoreGame();
let draft = Array(9).fill(null);
let selected = 0;
let invalidCells = new Set();

function restoreGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.guesses)) return AdaptiveFillomino.replay(saved.guesses);
  } catch (_) { /* Damaged or unavailable local storage starts a fresh game. */ }
  return new AdaptiveFillomino();
}

function saveGame() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guesses: game.getState().history.map(item => item.guess) }));
  } catch (_) { /* The game remains playable without storage. */ }
}

function say(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function renderInput() {
  inputBoard.replaceChildren();
  const finished = game.getState().status === 'won';
  draft.forEach((value, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell' + (selected === index ? ' selected' : '') + (invalidCells.has(index) ? ' invalid' : '');
    cell.textContent = value ?? '';
    cell.setAttribute('aria-label', `第 ${Math.floor(index / 3) + 1} 行，第 ${index % 3 + 1} 列，${value ?? '空白'}`);
    cell.setAttribute('aria-pressed', String(selected === index));
    cell.disabled = finished;
    cell.addEventListener('click', () => { selected = index; renderInput(); inputBoard.children[index].focus(); });
    inputBoard.append(cell);
  });
  $('submitButton').disabled = finished;
  $('sampleButton').disabled = finished;
  $('clearButton').disabled = finished;
}

function renderHistory() {
  const state = game.getState();
  $('turnNumber').textContent = '#' + (state.turn + 1);
  $('guessCount').textContent = state.turn;
  $('candidateCount').textContent = state.candidateCount;
  $('historyEmpty').hidden = state.turn > 0;
  historyList.replaceChildren();
  for (const record of state.history) {
    const item = document.createElement('article');
    item.className = 'history-item' + (record.status === 'won' ? ' won' : '');
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const turn = document.createElement('span');
    turn.textContent = '第 ' + record.turn + ' 次';
    const remaining = document.createElement('span');
    remaining.textContent = '剩余 ' + record.candidatesAfter;
    meta.append(turn, remaining);
    const board = document.createElement('div');
    board.className = 'mini-board';
    board.setAttribute('aria-label', `第 ${record.turn} 次猜测的反馈`);
    record.guess.forEach((number, index) => {
      const cell = document.createElement('span');
      cell.className = 'mini-cell ' + record.feedback[index];
      cell.textContent = number;
      cell.setAttribute('aria-label', `${number}，${{ green: '位置正确', yellow: '位置不对', gray: '没有匹配' }[record.feedback[index]]}`);
      board.append(cell);
    });
    item.append(meta, board);
    historyList.append(item);
  }
}

function render() { renderInput(); renderHistory(); }

function enterNumber(number) {
  if (game.getState().status === 'won') return;
  draft[selected] = number;
  invalidCells.clear();
  selected = Math.min(8, selected + 1);
  say('');
  renderInput();
}

function erase() {
  if (game.getState().status === 'won') return;
  if (draft[selected] === null && selected > 0) selected--;
  draft[selected] = null;
  invalidCells.clear();
  say('');
  renderInput();
}

function submit() {
  if (game.getState().status === 'won') return;
  if (draft.some(value => value === null)) {
    say('请先填满全部九个格子。', true);
    return;
  }
  const validation = validateBoard(draft);
  if (!validation.valid) {
    invalidCells = new Set(validation.regions.flatMap(region => region.cells));
    say('棋盘不合法：相同数字的每个连通块，格数必须等于该数字。红色格子所在的区域需要修改。', true);
    renderInput();
    return;
  }
  try {
    const result = game.submit(draft);
    saveGame();
    draft = Array(9).fill(null);
    invalidCells.clear();
    selected = 0;
    render();
    if (result.status === 'won') say(`猜中了！共用 ${result.turn} 次，答案终于无处可躲。`);
    else say(`本次排除 ${result.eliminated} 个答案，还剩 ${result.candidatesAfter} 个候选。`);
    historyList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    if (error instanceof InvalidGuessError) say(error.message, true);
    else throw error;
  }
}

function reset() {
  if (game.getState().turn && !window.confirm('清除当前猜测记录并重新开始？')) return;
  game.reset();
  draft = Array(9).fill(null);
  invalidCells.clear();
  selected = 0;
  saveGame();
  render();
  say('新的一局开始了。');
}

for (let number = 1; number <= 9; number++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = number;
  button.setAttribute('aria-label', `填入 ${number}`);
  button.addEventListener('click', () => enterNumber(number));
  keypad.append(button);
}
const deleteButton = document.createElement('button');
deleteButton.type = 'button';
deleteButton.className = 'delete-key';
deleteButton.textContent = '⌫ 删除';
deleteButton.addEventListener('click', erase);
keypad.append(deleteButton);

$('submitButton').addEventListener('click', submit);
$('clearButton').addEventListener('click', () => { draft.fill(null); invalidCells.clear(); selected = 0; renderInput(); say(''); });
$('sampleButton').addEventListener('click', () => {
  const boards = enumerateBoards();
  draft = boards[Math.floor(Math.random() * boards.length)].slice();
  invalidCells.clear();
  renderInput();
  say('已填入合法棋盘，可以修改或直接提交。');
});
$('newGameButton').addEventListener('click', reset);
$('helpButton').addEventListener('click', () => helpDialog.showModal());
$('closeHelpButton').addEventListener('click', () => helpDialog.close());
$('startButton').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', event => { if (event.target === helpDialog) helpDialog.close(); });

document.addEventListener('keydown', event => {
  if (helpDialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (/^[1-9]$/.test(event.key)) enterNumber(Number(event.key));
  else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); erase(); }
  else if (event.key === 'Enter') { event.preventDefault(); submit(); }
  else if (event.key === 'ArrowLeft') selected = Math.max(0, selected - 1);
  else if (event.key === 'ArrowRight') selected = Math.min(8, selected + 1);
  else if (event.key === 'ArrowUp') selected = Math.max(0, selected - 3);
  else if (event.key === 'ArrowDown') selected = Math.min(8, selected + 3);
  else return;
  if (event.key.startsWith('Arrow')) { event.preventDefault(); renderInput(); inputBoard.children[selected]?.focus(); }
});

render();
