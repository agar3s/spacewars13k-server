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

import { 
  math
} from "near-sdk-core";

import { Context, logging, storage, u128 } from 'near-sdk-as'
import { Player, GameAccount, Game, GAME_STATES, PLAYER_STATES, BattleLogRecord } from './models';
import { CroncatAPI } from './crossContracts';


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

// only when the game is finished ? ship owners
const shipToAccount = new PersistentMap<u32, string>("shipToAccount");
const accountToShips = new PersistentMap<string, Array<u16>>("accountToShips");

const availableShips = new PersistentVector<u16>("availableShips");
// player that played the game
const accountCredits = new PersistentMap<string, u8>("accountCredits");
// waiting list for the next game
const accountsQueue = new PersistentDeque<string>("queue");
// reset by game
const accountToPlayer = new PersistentMap<string, u8>("accountToPlayer");
const players = new PersistentVector<Player>("player");
const alivePlayers = new PersistentVector<u8>("alivePlayers");
const accountToLastBattle = new PersistentMap<string, string>("accountToBattle");
const battleLog = new PersistentMap<string, BattleLogRecord>("battleLog");

let GAME_STATE:u8 = 4;
let playersReady = 0;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;

const SHIPS_TO_MINT:u16 = 20;

// 0 = ROCK
// 1 = PAPER
// 2 = SCISSORS
const CARDS = [
  [0, 0],
  [1, 1],
  [2, 2],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 2],
  [2, 0],
  [2, 1]
];

// MESSAGES availables to be called by players
// new players join to a lobby game
// by default a new available game should be ready to be played

function setGameState(newState:u32): void {
  GAME_STATE = <u8>newState;
  storage.set('GAME_STATE', GAME_STATE);
}

function getGameState(): u8 {
  return storage.getPrimitive<u8>('GAME_STATE', GAME_STATE);
}

export function getAccount(account_id:string):GameAccount|null {
  if(!accountCredits.contains(account_id)) {
    return null;
  }
  const account = new GameAccount();

  account.ships = accountToShips.contains(account_id) ? accountToShips.getSome(account_id) : [];
  account.credits = accountCredits.getSome(account_id);
  if (accountToPlayer.contains(account_id)) {
    account.player = players[accountToPlayer.getSome(account_id)];
  }
  account.inQueue = getQueueTurn(account_id);
  return account;
}

function checkNewAccount (account_id:string):void {
  if (!accountCredits.contains(account_id)) {
    accountCredits.set(account_id, 1);
  }
}

@payable
export function addCredit():u8 {
  const attachedDeposit = Context.attachedDeposit;
  assert(attachedDeposit>=u128.from('100000000000000000000000'), 'credit cost 0.1 near or 10**23 yoctoNear');
  const account_id = Context.sender;
  // register this user give 1 free credit
  checkNewAccount(account_id);
  const availableCredits:u8 = accountCredits.getSome(account_id);
  if (availableCredits==255) {
    logging.log('can\'t add more credits to this account. max is 255');
    return availableCredits;
  }
  // ok, this is the interesting part, how to request money?
  accountCredits.set(account_id, availableCredits + 1);
  provisionShips(20);
  return availableCredits + 1;
}

function getQueueTurn(account_id:string):i16 {
  for (let i=0; i < accountsQueue.length; i++) {
    if (accountsQueue.__unchecked_get(i) == account_id) {
      return <i16>(accountsQueue.length - i);
    }
  }
  return -1;
}

// will use an available credit to join the game
export function joinGame():i8 {
  if (getGameState() === GAME_STATES.SETUP) {
    logging.log('can\'t join to the waiting list while the game is setting up.');
    return 0;
  }
  logging.log('waiting list');
  logging.log(accountsQueue.length);
  logging.log('join the game request by ' + Context.sender );
  const account_id = Context.sender;

  // register this user give 1 free credit
  checkNewAccount(account_id);

  if (getQueueTurn(account_id)!=-1) {
    logging.log(account_id + ' is already in the waiting list.');
    return 1;
  }

  // validate player has enough credits to play
  const availableCredits:u8 = accountCredits.getSome(account_id);
  if (availableCredits === 0) {
    // account doesn't have enough credits to play;
    logging.log(account_id + ' does not have enough credits to play');
    return 2;
  }

  accountCredits.set(account_id, availableCredits - 1);
  accountsQueue.pushFront(account_id);
  logging.log(account_id + ' join to the waiting list.');
  return 3;
};


// players decide to start the game ???? review this flow
export function startGame():void {
  assert(validateAdmin(), 'You are not authorized to run this function');
  if (getGameState() !== GAME_STATES.LOBBY) {
    logging.log('Game is not in Lobby STATE');
    return;
  }
  if (accountsQueue.length < MIN_PLAYERS){
    logging.log('There are not enough players to start the game');
    return;
  }
  setGameState(GAME_STATES.SETUP);
  logging.log('starting a new game');

  // is this code needed? maybe at the moment of starting the game
  // I can remove all the people from the accountsQueue and 
  // joining here.


  for (let i = accountsQueue.length - 1; i >= 0 && players.length < MAX_PLAYERS; i--) {
    const account_id = accountsQueue.popBack();
    const player = new Player();
    player.id = <u8>players.length;
    player.account = account_id;
    logging.log(player.account + ' joins the game');
    player.ship = assignShip(player.account);
    player.arsenal = [0, 1, 2, randomShortNum(9)];
    player.wins = 0;
    player.state = <u8>PLAYER_STATES.SETUP;
    players.push(player);

    alivePlayers.push(player.id);
    accountToPlayer.set(account_id, player.id);

    //logging.log('player ' + player.account + ' ' + player.id +' has ship: ' + player.ship + ' with cards: ' + player.cards);
  }

  newTurn();
};

// players set their hands
export function setHand(hand:u8[]):u8 {
  if (getGameState() !== GAME_STATES.WAIT_PLAYERS) {
    logging.log('hand can\'t be set now');
    return 0;
  }
  const account_id = Context.sender;
  if (!accountToPlayer.contains(account_id)) {
    logging.log('this player is not playing');
    return 1;
  }
  let playerIndex = accountToPlayer.getSome(account_id);
  let player = players[playerIndex];
  if (player.state === PLAYER_STATES.DEAD) {
    logging.log('this player is not longer alive in this game');
    return 2;
  }
  if (hand.length !== 3) {
    logging.log('hand must contain 3 cards exactly');
    return 3;
  }

  const totalCards: u8 = <u8>player.arsenal.length;
  let validatedHand: u8[] = [];
  for (let i=0; i<hand.length; i++) {
    let element = hand[i];
    if (hand.indexOf(element) == i && element < totalCards) {
      validatedHand.push(element);
    }
  }

  if (validatedHand.length !== 3){
    logging.log('hand can\'t contain duplicated cards');
    return 4;
  }
  player.hand = hand;
  if (player.state !== PLAYER_STATES.READY) {
    player.state = <u8>PLAYER_STATES.READY;
    playersReady = storage.getSome<u8>('playersReady');
    playersReady += 1;
    storage.set('playersReady', playersReady);
  }
  players[player.id] = player;
  return 5;
  /*if (playersReady === alivePlayers.length) {
    solveTurn();
  }*/
};

// players ask to solve the next turn
export function solveTurn():void {
  assert(validateAdmin(), 'You are not authorized to run this function');
  if (getGameState() !== GAME_STATES.WAIT_PLAYERS) {
    logging.log('game state is not valid to solve this turn');
    return;
  }
  logging.log('\n\nSOLVING NEW TURN');
  setGameState(GAME_STATES.SOLVING_TURN);
  const readyPlayers: u8[] = [];
  for (let i=0; i<alivePlayers.length; i++) {
    readyPlayers.push(alivePlayers[i]);
  }
  readyPlayers.sort(randomSort);
  logging.log(readyPlayers);
  logging.log(readyPlayers.length);
  // remove old battlelogs
  resetBattleLogs();
  logging.log('setting up the battle');
  for (let i = 0; i < readyPlayers.length; i+=2) {
    if (isNaN(readyPlayers[i+1])) break;
    battle(readyPlayers[i], readyPlayers[i + 1]);
  }

  // reset alive players
  logging.log(alivePlayers);
  for (let index = alivePlayers.length - 1; index >= 0; index--) {
    alivePlayers.pop();
  }

  // reassign alive players
  for (let i = 0; i< readyPlayers.length; i+=1) {
    let playerIndex = readyPlayers[i];
    if (players[playerIndex].state !== PLAYER_STATES.DEAD) {
      alivePlayers.push(playerIndex);
    }
  }
  // if only one player remains, the game is over
  if (alivePlayers.length === 1) {
    closeGame();
  } else {
    const turn = storage.getPrimitive<u8>('GAME_TURN', 0);
    storage.set('GAME_TURN', turn+1);
    newTurn();
  }
};

// get current game status
export function getGame ():Game {
  const game = new Game();
  game.totalPlayers = <u8>alivePlayers.length;
  game.waitingPlayers = <u8>accountsQueue.length;
  game.id = storage.getPrimitive<u16>('GAME_ID', 0);
  game.round = storage.getPrimitive<u8>('GAME_TURN', 0);
  game.state = getGameState();
  game.playersReady = storage.getSome<u8>('playersReady');
  return game;
};

// get current player
export function getPlayer (id:u8):Player|null {
  let player = players[id];
  return player;
};


// aux functions
export function newGame (): void {
  assert(validateAdmin(), 'You are not authorized to run this function');
  //if (getGameState() !== GAME_STATES.OVER) return;
  setGameState(GAME_STATES.BUSY);
  resetBattleLogs();
  for (let index = players.length - 1; index >= 0; index--) {
    const player:Player = players[index];
    accountToPlayer.delete(player.account);
    players.pop();
  }
  for (let index = alivePlayers.length - 1; index >= 0; index--) {
    alivePlayers.pop();
  }
  storage.set('playersReady', 0);
  setGameState(GAME_STATES.LOBBY);
  const gameNumber:u16 = storage.getPrimitive<u16>('GAME_ID', 0);
  storage.set('GAME_ID', gameNumber + 1);
  storage.set('GAME_TURN', 0);
  logging.log('new game created: ' + (gameNumber + 1).toString());
};

function getAvailableShipIndex (): u32 {
  return randomNum(availableShips.length);
};

function assignShip (account: string): u16 {
  let shipIndex = getAvailableShipIndex();
  return availableShips.swap_remove(shipIndex);
};


function randomHand (index:u8): u8[] {
  let player = players[index];
  return player.arsenal.map<u8>((card, index) => <u8>index).sort(randomSort).slice(0, 3);
};

function sortCurrentHand (index:u8): u8[] {
  let player = players[index];
  logging.log('player.hand at sort?');
  logging.log(player.hand);
  player.hand.sort(randomSort);
  return player.hand;
  //logging.log(player.hand);
  //players[player.id] = player;
};

function newTurn (): void {
  logging.log('new turn');
  setGameState(GAME_STATES.WAIT_PLAYERS);
  for (let i = 0; i < alivePlayers.length; i++) {
    const playerIndex = alivePlayers[i];
    let player = players[playerIndex];
    player.hand = randomHand(playerIndex);
    player.state = <u8>PLAYER_STATES.WAIT;
    players[player.id] = player;
  }
  playersReady = 0;
  storage.set('playersReady', playersReady);
  //setTimeout(solveTurn, TIME_TO_NEW_TURN);
};

function pickRandomCard (index:u8): u8 {
  let player = players[index];
  const size:u8 = <u8>player.arsenal.length;
  const randomPick = randomShortNum(size);
  return player.arsenal[randomPick];
};

function transferShipToAccount (account_id:string, ship:u16): void {
  shipToAccount.set(ship, account_id);
  let ships:u16[] = [];
  if (accountToShips.contains(account_id)) {
    ships = accountToShips.getSome(account_id);
  }
  ships.push(ship);
  accountToShips.set(account_id, ships);
}

function closeGame (): void {
  logging.log('ENDING GAME');
  const winnerPlayerIndex = alivePlayers[0];
  const winnerPlayer = players[winnerPlayerIndex];
  logging.log(winnerPlayer.account + ' is the winner');
  // free dead players
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (i === winnerPlayerIndex) {
      transferShipToAccount(player.account, player.ship);
    } else {
      // return ships to the list
      availableShips.push(player.ship);
    }
  }
  logging.log(availableShips.length);
  setGameState(GAME_STATES.OVER);
  //setTimeout(newGame, TIME_TO_NEW_GAME);
};

function battle (indexPlayerA:u8, indexPlayerB:u8):void {
  let playerA = players[indexPlayerA];
  let playerB = players[indexPlayerB];
  const battleLog = new BattleLogRecord();
  battleLog.playerA = indexPlayerA;
  battleLog.playerB = indexPlayerB;
  battleLog.shipA = playerA.ship;
  battleLog.shipB = playerB.ship;
  battleLog.arsenalA = playerA.arsenal.slice(0);
  battleLog.arsenalB = playerB.arsenal.slice(0);

  let scores = [0, 0];
  let battleRound = 0;
  while (scores[0]<2&&scores[1]<2) {
    if (battleRound>10) break;
    logging.log('battle round');
    logging.log(battleRound);
    let handA:u8[];
    let handB:u8[];
    switch (battleRound) {
      case 0:
        handA = playerA.hand.slice(0);
        handB = playerB.hand.slice(0);
      break;
      case 1:
        handA = sortCurrentHand(indexPlayerA).slice(0);
        handB = sortCurrentHand(indexPlayerB).slice(0);
      break;
      case 2: 
        handA = randomHand(indexPlayerA);
        handB = randomHand(indexPlayerB);
      break;
        default:
          handA = [randomShortNum(<u8>playerA.arsenal.length)];
          handB = [randomShortNum(<u8>playerB.arsenal.length)];
        break;
    }
    let score = 0;
    for (let i=0;i<handA.length;i++) {
      score += solveCardAbsolute(playerA.arsenal[handA[i]], playerB.arsenal[handB[i]]);
    }

    if (score>0) scores[0]++;
    if (score<0) scores[1]++;
    //console.log(battleRound, handA, handB);
    //console.log(res);
    battleLog.rounds.push([handA, handB]);
    battleRound += 1;
  }
  
  battleLog.winner = scores[0]>scores[1]?indexPlayerA:indexPlayerB;
  if (scores[0]>scores[1]) {
    //logging.log('player ' + indexPlayerA + ' wins');
    playerA.wins += 1;
    playerA.arsenal.push(pickRandomCard(indexPlayerB));
    playerB.state = <u8>PLAYER_STATES.DEAD;
  } else {
    //logging.log('player ' + indexPlayerB + ' wins');
    playerB.wins += 1;
    playerB.arsenal.push(pickRandomCard(indexPlayerA));
    playerA.state = <u8>PLAYER_STATES.DEAD;
  }
  players[playerA.id] = playerA;
  players[playerB.id] = playerB;
  saveBattleLog(battleLog);
}

function solveCardAbsolute (cardAIndex:u8, cardBIndex:u8):i8 {
  let res = solveCards(cardAIndex, cardBIndex, false);
  if (res === 0) {
    res = solveCards(cardAIndex, cardBIndex, true);
  }
  return res;
}

function solveCards (cardAIndex:u8, cardBIndex:u8, second:bool): i8 {
  const cardA = CARDS[cardAIndex][second?1:0];
  const cardB = CARDS[cardBIndex][second?1:0];
  if (cardA === 0 && cardB === 2) return 1;
  if (cardA === 1 && cardB === 0) return 1;
  if (cardA === 2 && cardB === 1) return 1;
  if (cardA === cardB) return 0;
  return -1;
};

function saveBattleLog (battleLogRecord:BattleLogRecord):void {
  const accountA = players[battleLogRecord.playerA].account;
  const accountB = players[battleLogRecord.playerB].account;
  const id:string = accountA.concat(accountB);
  battleLog.set(id, battleLogRecord);
  accountToLastBattle.set(accountA, id);
  accountToLastBattle.set(accountB, id);
}
export function getLastBattleLog (account_id:string):BattleLogRecord|null {
  if(!accountToLastBattle.contains(account_id)) {
    logging.log('there is no battle record for this account');
    return null;
  }
  const id = accountToLastBattle.getSome(account_id);
  if(!battleLog.contains(id)) {
    logging.log('there is no battle record for this account');
    return null;
  }
  return battleLog.getSome(id);
}

function resetBattleLogs ():void {
  for (let index = players.length - 1; index >= 0; index--) {
    const account_id = players[index].account;
    if (accountToLastBattle.contains(account_id)) {
      const id = accountToLastBattle.getSome(account_id);
      if (battleLog.contains(id)) {
        battleLog.delete(id);
      }
      accountToLastBattle.delete(id);
    }
  }
}

export function emptyAll (account_id:string):void {
  assert(validateAdmin(), 'You are not authorized to run this function');

  for (let index = players.length - 1; index >= 0; index--) {
    players.pop();
  }
  for (let index = alivePlayers.length - 1; index >= 0; index--) {
    alivePlayers.pop();
  }
  for (let index = accountsQueue.length - 1; index >= 0; index--) {
    accountsQueue.popBack();
  }
  
  accountToShips.delete(account_id);
  accountCredits.delete(account_id);
  accountToPlayer.delete(account_id);
}

function validateAdmin (): bool {
  return Context.sender == Context.contractName;
}

export function adminCall (): void {
  assert(validateAdmin(), 'You are not authorized to run this function');
}

export function provisionShips (ships:u16): void {
  const from = storage.getPrimitive<u16>('NEXT_SHIP_INDEX', u16(availableShips.length));
  const max:u16 = 13*1024;
  assert(from<max, 'max number of ships alreay provisioned');
  let i:u16 = from;
  let maxLocal:u16 = (from+ships);
  for(;i < maxLocal && i < max; i++) {
    availableShips.push(<i16>i);
  }
  storage.set('NEXT_SHIP_INDEX', i);
}

export function getAvailableShips ():u16[] {
  assert(validateAdmin(), 'You are not authorized to run this function');
  const mapp:u16[] = [];
  for (let index = 50; index < 150; index++) {
    const element = availableShips[index];
    mapp.push(element);
  }
  return mapp;
}

export function checkBattleLog ():void {
  logging.log(availableShips.length);
  logging.log(availableShips[availableShips.length-1]);
}

// croncat experimentation
export function ping ():void {
  logging.log("creting croncat");
  let croncat = new CroncatAPI();
  logging.log("scheduling");
  let promise = croncat.ping('pong');
  logging.log("scheduled");
  promise.returnAsResult();
}

export function pong ():void {
  logging.log('pong');
}