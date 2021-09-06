/*
 * This is an example of an AssemblyScript smart contract with two simple,
 * symmetric functions:
 *
 * 1. setGreeting: accepts a greeting, such as "howdy", and records it for the
 *    user (account_id) who sent the request
 * 2. getGreeting: accepts an account_id and returns the greeting saved for it,
 *    defaulting to "Hello"
 *
 * Learn more about writing NEAR smart contracts with AssemblyScript:
 * https://docs.near.org/docs/roles/developer/contracts/assemblyscript
 *
 */

import {
  PersistentMap, // implementation of a map you would find in most languages
  PersistentVector, // implementation of an array you would find in most languages
  PersistentDeque, // implementation of a deque (bidirectional queue)
} from "near-sdk-as";

import { math } from "near-sdk-core";

import { Context, logging, storage } from 'near-sdk-as'
import { Player, GAME_STATES, PLAYER_STATES } from './models';

// a function to generate random numbers
function randomNum(max:u32): u32 {
  let buf = math.randomBuffer(4);
  return (
    (((0xff & buf[0]) << 24) |
      ((0xff & buf[1]) << 16) |
      ((0xff & buf[2]) << 8) |
      ((0xff & buf[3]) << 0)) %
    max
  );
}

// short random
function randomShortNum(max:u8): u8 {
  let buf = math.randomBuffer(2);
  return (
    (((0xff & buf[0]) << 8) |
      ((0xff & buf[1]) << 0)) %
    max
  );
}
// random true / false
function flipCoin(): bool {
  let buf = math.randomBuffer(1);
  return buf[0] > 124;
}

function randomSort(value:u8, index:u8): i32 {
  return flipCoin()?-1:1;
}

//const shipToOwner = new PersistentMap<TokenId, AccountId>('a')

let shipToAccount = new PersistentMap<u32, string>("shipToAccount");
let accountToPlayer = new PersistentMap<string, u8>("accountToPlayer");
let players = new PersistentVector<Player>("playerz");
let alivePlayers = new PersistentVector<u8>("alivePlayers");
let GAME_STATE:u8 = 4;
let playersReady = 0;
let gameNumber = 0;
let winners = new PersistentMap<u8, string>("winners");

const MIN_PLAYERS = 8;

// MESSAGES availables to be called by players
// new players join to a lobby game
// by default a new available game should be ready to be played

function setGameState(newState:u32): void {
  GAME_STATE = <u8>newState;
  storage.set('GAME_STATE', GAME_STATE);
}

export function getGameState(): u8 {
  if (!storage.hasKey('GAME_STATE')) {
    //storage.set('GAME_STATE', GAME_STATES.LOBBY);
    return GAME_STATE;
  }
  return storage.getSome<u8>('GAME_STATE');
}

export function getAccountToPlayer():i8 {
  const account_id = Context.sender;
  if (accountToPlayer.contains(account_id)) {
    const player_index = accountToPlayer.getSome(account_id);
    logging.log(player_index);
    return player_index;
  };
  return -1;
};

export function joinGame():i8 {
  logging.log('join the game request by ' + Context.sender );
  if (getGameState() !== GAME_STATES.LOBBY) return -1;
  const account_id = Context.sender;
  if (accountToPlayer.contains(account_id)) {
    const player_index = accountToPlayer.getSome(account_id);
    logging.log(player_index);
    return player_index;
  };
  let player = new Player();
  player.id = <u8>players.length;
  player.account = account_id;
  players.push(player);
  logging.log(player.account + ' joins the game');
  logging.log(player);
    //position,
  accountToPlayer.set(account_id, player.id);
  if (players.length == MIN_PLAYERS) {
    // starts game in 5 mins;
    //logging.log('game will start in 5 minutes');
    //setTimeout(startGame, TIME_TO_START_GAME);
    startGame();
  }
  return player.id;
};

// players decide to start the game
export function startGame():void {
  if (getGameState() !== GAME_STATES.LOBBY) return;
  if (players.length < MIN_PLAYERS) return;
  setGameState(GAME_STATES.SETUP);
  //console.log('STARTING GAME, SETING UP PLAYERS');
  for (let i = 0; i < players.length; i++) {
    setupPlayer(<u8>i);
  }
  newTurn();
  //storage.set('GAME_STATE', GAME_STATE);
};

// players set their hands
export function setHand(hand:u8[]):void {
  if (getGameState() !== GAME_STATES.WAIT_PLAYERS) {
    return;
  }
  const account_id = Context.sender;
  if (!accountToPlayer.contains(account_id)) {
    return;
  }
  let playerIndex = accountToPlayer.getSome(account_id);
  let player = players[playerIndex];
  if (player.state === PLAYER_STATES.DEAD) return;
  if (hand.length !== 3) return;

  const totalCards: u8 = <u8>player.cards.length;
  let validatedHand: u8[] = [];
  for (let i=0; i<hand.length; i++) {
    let element = hand[i];
    if (hand.indexOf(element) == i && element < totalCards) {
      validatedHand.push(element);
    }
  }

  if (validatedHand.length !== 3) return;
  player.hand = hand;
  if (player.state !== PLAYER_STATES.READY) {
    player.state = <u8>PLAYER_STATES.READY;
    playersReady = storage.getSome<u8>('playersReady');
    playersReady += 1;
    storage.set('playersReady', playersReady);
  }
  if (playersReady === alivePlayers.length) {
    solveTurn();
  }
};

// players ask to solve the next turn
export function solveTurn():void {
  if (getGameState() !== GAME_STATES.WAIT_PLAYERS) return;
  logging.log('\n\nSOLVING NEW TURN');
  setGameState(GAME_STATES.SOLVING_TURN);
  const readyPlayers: u8[] = [];
  for (let i=0;i<alivePlayers.length; i++) {
    readyPlayers.push(alivePlayers[i]);
  }
  readyPlayers.sort(randomSort);
  for (let i = 0; i < readyPlayers.length; i+=2) {
    if (!readyPlayers[i+1]) break;
    battle(readyPlayers[i], readyPlayers[i + 1], 0);
  }
  alivePlayers = new PersistentVector<u8>("alivePlayers");
  for (let i = 0; i< readyPlayers.length; i+=1) {
    let playerIndex = readyPlayers[i];
    if (players[playerIndex].state !== PLAYER_STATES.DEAD) {
      alivePlayers.push(playerIndex);
    }
  }
  
  if (alivePlayers.length === 1) {
    closeGame();
  } else {
    newTurn();
  }
};

// get current game status
export function getGame ():Player[]|null {
  // TODO
  logging.log(accountToPlayer);
  logging.log(players);
  logging.log(players.length);
  let parsedPlayers: Player[] = [];
  for (let i=0;i<players.length;i++) {
    parsedPlayers.push(players[0]);
  }
  return parsedPlayers;
};

// get current player
export function getPlayer (id:u8):Player|null {
  let player = players[id];
  return player;
};

export function testAlgo(max:u32):u32 {
  return randomNum(max);
};


export function testShort(max:u8):u8 {
  return randomShortNum(max);
};

export function testFlip():bool {
  return flipCoin();
};


export function testSort():u8[] {
  const numbers: u8[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  numbers.sort(randomSort);
  return numbers;
};


// aux functions
export function newGame (): void {
  //if (getGameState() !== GAME_STATES.OVER) return;
  setGameState(GAME_STATES.BUSY);
  for (let index = 0; index < players.length; index++) {
    const player:Player = players[index];
    accountToPlayer.delete(player.account);
  }
  //accountToPlayer.delete('dev-1629007181166-2789359');
  //logging.log(players.isEmpty);
  //accountToPlayer = new PersistentMap<string, u8>("accountToPlayer");
  players = new PersistentVector<Player>("playerz");
  alivePlayers = new PersistentVector<u8>("alivePlayers");
  storage.set('playersReady', 0);
  setGameState(GAME_STATES.LOBBY);
};

function getAvailableShip (): u32 {
  let shipId = randomNum(10000);
  if (shipToAccount.contains(shipId)) {
    return getAvailableShip();
  }
  return shipId;
};

function assignShip (account: string): u32 {
  let shipId = getAvailableShip();
  shipToAccount.set(shipId, account);
  return shipId;
};

function setupPlayer (index:u8): void {
  let player = players[index];
  player.ship = assignShip(player.account);
  player.cards = [0, 1, 2, randomShortNum(3)];
  //player.log = [];
  player.wins = 0;
  player.state = <u8>PLAYER_STATES.SETUP;
  alivePlayers.push(index);
  logging.log(`player ${ player.account }/${ index } has ship: ${ player.ship } with cards: ${ player.cards }`);
};

function randomHand (index:u8): void {
  let player = players[index];
  player.hand = player.cards.map<u8>((card, index) => <u8>index).sort(randomSort).slice(0, 3);
};

function sortCurrentHand (index:u8): void {
  let player = players[index];
  player.hand.sort(randomSort);
};

function newTurn (): void {
  //console.log('NEW TURN');
  setGameState(GAME_STATES.WAIT_PLAYERS);
  for (let i = 0; i < alivePlayers.length; i++) {
    const playerIndex = alivePlayers[i];
    randomHand(playerIndex);
    players[playerIndex].state = <u8>PLAYER_STATES.WAIT;
  }
  playersReady = 0;
  storage.set('playersReady', playersReady);
  //setTimeout(solveTurn, TIME_TO_NEW_TURN);
};

function pickRandomCard (index:u8): u8 {
  let player = players[index];
  const size:u8 = <u8>player.cards.length;
  const randomPick = randomShortNum(size);
  // logging.log(`random card pick ${ randomPick } => ${ player.cards[randomPick] }`);
  return player.cards[randomPick];
};

function closeGame (): void {
  logging.log('ENDING GAME');
  const winnerPlayerIndex = alivePlayers[0];
  logging.log(`${ winnerPlayerIndex } is the winner`);
  // free dead players
  for (let i = 0; i < players.length; i++) {
    if (i === winnerPlayerIndex) continue;
    const player = players[i];
    shipToAccount.delete(player.ship);
  }
  logging.log(shipToAccount);
  setGameState(GAME_STATES.OVER);
  //setTimeout(newGame, TIME_TO_NEW_GAME);
};

function battle (indexPlayerA:u8, indexPlayerB:u8, round:u8): void {
  
  logging.log(`${ indexPlayerA } vs ${ indexPlayerB } round ${ round }`);
  let playerA = players[indexPlayerA];
  let playerB = players[indexPlayerB];
  //logging.log(`${ playerA.hand.map((index)=>CARD_NAMES[playerA.cards[index]]) } vs ${ playerB.hand.map((index)=>CARD_NAMES[playerB.cards[index]]) } round ${ round }`);
  let points = 0;
  for (let i=0; i<3; i++) {
    const cardA = playerA.cards[playerA.hand[i]];
    const cardB = playerB.cards[playerB.hand[i]];
    points += solveCards(cardA, cardB);
  }
  if (points === 0) {
    if (round === 0) {
      logging.log('TIE, sorting current hand');
      sortCurrentHand(indexPlayerA);
      sortCurrentHand(indexPlayerB);
      battle(indexPlayerA, indexPlayerB, 1);
      return;
    }
    if (round === 1) {
      logging.log('TIE, random new hand');
      randomHand(indexPlayerA);
      randomHand(indexPlayerB);
      battle(indexPlayerA, indexPlayerB, 2);
      return;
    }
    logging.log(`TIE, player with more wins win: ${ playerA.wins } vs ${ playerB.wins }`);
    points = playerA.wins - playerB.wins;
    if (points === 0) {
      logging.log(`TIE, random player wins`);
      points = randomSort(0, 0);
    }
  }
  // playerA wins
  if (points > 0) {
    logging.log(`player ${ indexPlayerA } wins`);
    playerA.wins += 1;
    playerA.cards.push(pickRandomCard(indexPlayerB));
    playerB.state = <u8>PLAYER_STATES.DEAD;
  }
  
  if (points < 0) {
    logging.log(`player ${ indexPlayerB } wins`);
    playerB.wins += 1;
    playerB.cards.push(pickRandomCard(indexPlayerA));
    playerA.state = <u8>PLAYER_STATES.DEAD;
  }
};

function solveCards (cardA:u8, cardB:u8): i8 {
  if (cardA === cardB) return 0;
  if (cardA === 0 && cardB === 1) return 1;
  if (cardA === 0 && cardB === 2) return -1;
  if (cardA === 1 && cardB === 0) return -1;
  if (cardA === 1 && cardB === 2) return 1;
  if (cardA === 2 && cardB === 0) return 1;
  if (cardA === 2 && cardB === 1) return -1;
  return 0;
};

newGame();