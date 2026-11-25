/** Zero-dependency, browser/Node compatible adaptive 3x3 Fillomino judge. */
export const BOARD_SIZE = 3;
export const CELL_COUNT = 9;
export const WIN_PATTERN = 'GGGGGGGGG';
const COLORS = Object.freeze({ G: 'green', Y: 'yellow', B: 'gray' });
const NEIGHBORS = Array.from({ length: 9 }, (_, i) =>
  Array.from({ length: 9 }, (_, j) => j).filter(j =>
    Math.abs(Math.floor(i / 3) - Math.floor(j / 3)) + Math.abs(i % 3 - j % 3) === 1));

export class InvalidGuessError extends Error {
  constructor(message, code = 'INVALID_BOARD') {
    super(message);
    this.name = 'InvalidGuessError';
    this.code = code;
  }
}

/** Normalize an exact 9-digit string, flat array, or 3x3 array. No coercion. */
export function normalizeBoard(input) {
  let board;
  if (typeof input === 'string' && /^[1-9]{9}$/.test(input)) {
    board = [...input].map(Number);
  } else if (Array.isArray(input)) {
    if (input.length === 3 && input.every(row => Array.isArray(row) && row.length === 3)) {
      board = input.flat();
    } else {
      board = input.slice();
    }
  }
  if (!board || board.length !== 9 || Array.from(board).some(v => !Number.isInteger(v) || v < 1 || v > 9)) {
    throw new InvalidGuessError('棋盘必须是 9 个 1～9 的整数，按行排列。', 'INVALID_FORMAT');
  }
  return board;
}

function invalidRegions(board) {
  const seen = new Set();
  const errors = [];
  for (let start = 0; start < 9; start++) {
    if (seen.has(start)) continue;
    const cells = [start];
    seen.add(start);
    for (let p = 0; p < cells.length; p++) {
      for (const next of NEIGHBORS[cells[p]]) {
        if (!seen.has(next) && board[next] === board[start]) {
          seen.add(next);
          cells.push(next);
        }
      }
    }
    if (cells.length !== board[start]) {
      errors.push({ value: board[start], size: cells.length, cells });
    }
  }
  return errors;
}

export function validateBoard(input) {
  let board;
  try { board = normalizeBoard(input); }
  catch (error) {
    if (!(error instanceof InvalidGuessError)) throw error;
    return { valid: false, code: error.code, message: error.message, regions: [] };
  }
  const regions = invalidRegions(board);
  return regions.length
    ? { valid: false, code: 'INVALID_REGIONS', message: '每个同数字四连通块的格数必须等于该数字。', regions }
    : { valid: true, code: null, message: '', regions: [] };
}

let cachedBoards;
function boardStrings() {
  if (cachedBoards) return cachedBoards;
  // Restricted-growth set partitions: exactly Bell(9)=21147 leaves.
  // A valid coloring determines one connected partition, so no valid coloring
  // is missed. The Set also makes the external uniqueness contract explicit.
  const blocks = [];
  const result = new Set();
  function visit(cell) {
    if (cell === 9) {
      const board = Array(9).fill(0);
      for (const block of blocks) for (const i of block) board[i] = block.length;
      if (invalidRegions(board).length === 0) result.add(board.join(''));
      return;
    }
    for (const block of blocks) {
      block.push(cell); visit(cell + 1); block.pop();
    }
    blocks.push([cell]); visit(cell + 1); blocks.pop();
  }
  visit(0);
  cachedBoards = Object.freeze([...result].sort());
  return cachedBoards;
}

/** Every legal board, with rotations/reflections treated as different boards. */
export function enumerateBoards() {
  return boardStrings().map(s => [...s].map(Number));
}

function checkMode(mode) {
  if (mode !== 'wordle' && mode !== 'presence') {
    throw new TypeError('feedbackMode must be "wordle" or "presence".');
  }
}

function patternFor(guess, answer, mode) {
  const pattern = Array(9).fill('B');
  if (mode === 'presence') {
    for (let i = 0; i < 9; i++) pattern[i] = guess[i] === answer[i] ? 'G' : answer.includes(guess[i]) ? 'Y' : 'B';
  } else {
    const unused = Array(10).fill(0);
    for (let i = 0; i < 9; i++) {
      if (guess[i] === answer[i]) pattern[i] = 'G';
      else unused[Number(answer[i])]++;
    }
    // Standard Wordle: reserve greens, then allocate yellows left-to-right.
    for (let i = 0; i < 9; i++) {
      if (pattern[i] !== 'G' && unused[Number(guess[i])] > 0) {
        pattern[i] = 'Y'; unused[Number(guess[i])]--;
      }
    }
  }
  return pattern.join('');
}

/** Pure feedback function; inputs need not be legal Fillomino partitions. */
export function scoreGuess(guess, answer, feedbackMode = 'wordle') {
  checkMode(feedbackMode);
  const pattern = patternFor(normalizeBoard(guess), normalizeBoard(answer), feedbackMode);
  return { pattern, feedback: [...pattern].map(c => COLORS[c]) };
}

/** One point per maximal four-connected region, regardless of its number. */
export function evaluateBoard(input) {
  const board = normalizeBoard(input);
  const seen = new Set();
  let regions = 0;
  for (let start = 0; start < CELL_COUNT; start++) {
    if (seen.has(start)) continue;
    regions++;
    const queue = [start];
    seen.add(start);
    for (let p = 0; p < queue.length; p++) {
      for (const next of NEIGHBORS[queue[p]]) {
        if (!seen.has(next) && board[next] === board[start]) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  return regions;
}

/** Stable softmax; temperature > 0 controls how strongly high scores dominate. */
export function softmax(scores, temperature = 1) {
  if (!Array.isArray(scores) || scores.some(score => !Number.isFinite(score))) {
    throw new TypeError('scores must be an array of finite numbers.');
  }
  if (!Number.isFinite(temperature) || temperature <= 0) {
    throw new TypeError('temperature must be a positive finite number.');
  }
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const weights = scores.map(score => Math.exp((score - max) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => weight / total);
}

function copyRecord(record) {
  return { ...record, guess: record.guess.slice(), feedback: record.feedback.slice() };
}

export class AdaptiveFillomino {
  #options;
  #candidates;
  #history = [];
  #won = false;
  #randomState;

  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object.');
    const { feedbackMode = 'wordle', requireValidGuess = true,
      temperature = 1, seed = Math.floor(Math.random() * 0x100000000) } = options;
    checkMode(feedbackMode);
    if (typeof requireValidGuess !== 'boolean') throw new TypeError('requireValidGuess must be a boolean.');
    if (!Number.isFinite(temperature) || temperature <= 0) throw new TypeError('temperature must be a positive finite number.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be an unsigned 32-bit integer.');
    this.#options = Object.freeze({ feedbackMode, requireValidGuess, temperature, seed });
    this.#candidates = boardStrings().slice();
    this.#randomState = seed;
  }

  #nextRandom() {
    this.#randomState = (Math.imul(this.#randomState, 1664525) + 1013904223) >>> 0;
    return this.#randomState / 0x100000000;
  }

  /** Invalid input or a finished game throws without changing any state. */
  submit(input) {
    if (this.#won) throw new InvalidGuessError('本局已经结束，请先 reset()。', 'GAME_OVER');
    const guess = normalizeBoard(input);
    if (this.#options.requireValidGuess && invalidRegions(guess).length) {
      throw new InvalidGuessError('每个同数字四连通块的格数必须等于该数字。', 'INVALID_REGIONS');
    }
    const key = guess.join('');
    const before = this.#candidates.length;
    // Preserve the adaptive rule: a guess cannot win while another answer remains.
    const eligible = before > 1 ? this.#candidates.filter(answer => answer !== key) : this.#candidates;
    const probabilities = softmax(eligible.map(evaluateBoard), this.#options.temperature);
    const draw = this.#nextRandom();
    let cumulative = 0;
    let sampled = eligible[eligible.length - 1];
    for (let i = 0; i < eligible.length; i++) {
      cumulative += probabilities[i];
      if (draw < cumulative) { sampled = eligible[i]; break; }
    }
    const pattern = patternFor(key, sampled, this.#options.feedbackMode);
    this.#candidates = this.#candidates.filter(answer => patternFor(key, answer, this.#options.feedbackMode) === pattern);
    this.#won = pattern === WIN_PATTERN;
    const record = {
      turn: this.#history.length + 1,
      guess,
      pattern,
      feedback: [...pattern].map(c => COLORS[c]),
      candidatesBefore: before,
      candidatesAfter: this.#candidates.length,
      eliminated: before - this.#candidates.length,
      forcedBeforeGuess: before === 1,
      status: this.#won ? 'won' : 'playing',
    };
    this.#history.push(record);
    return copyRecord(record);
  }

  /** Detached public state: callers cannot mutate the judge through this. */
  getState() {
    return {
      boardSize: 3,
      options: { ...this.#options },
      turn: this.#history.length,
      initialCandidateCount: boardStrings().length,
      candidateCount: this.#candidates.length,
      isUnique: this.#candidates.length === 1,
      status: this.#won ? 'won' : 'playing',
      answer: this.#won ? [...this.#candidates[0]].map(Number) : null,
      history: this.#history.map(copyRecord),
    };
  }

  /** For tests, analysis or explicit hints; do not render this in normal play. */
  getCandidates() { return this.#candidates.map(s => [...s].map(Number)); }

  reset() {
    this.#history = [];
    this.#won = false;
    this.#candidates = boardStrings().slice();
    this.#randomState = this.#options.seed;
    return this.getState();
  }

  /** Rebuild state from guesses; never trust client-supplied feedback/candidates. */
  static replay(guesses, options = {}) {
    if (!Array.isArray(guesses)) throw new TypeError('guesses must be an array.');
    const game = new AdaptiveFillomino(options);
    for (const guess of guesses) game.submit(guess);
    return game;
  }
}
