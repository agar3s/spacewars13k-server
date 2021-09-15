//import { JSON } from "assemblyscript-json";
import { u128 } from "as-bignum";
export const enum GAME_STATES {
  LOBBY = 1,
  SETUP = 2,
  WAIT_PLAYERS = 3,
  SOLVING_TURN = 4,
  OVER = 5,
  BUSY = 0
};

export const enum PLAYER_STATES {
  JOINED = 1,
  SETUP = 2,
  READY = 3,
  WAIT = 4,
  DEAD = 5
};

@nearBindgen
export class Player {
  id: u8=0;
  account: string="";
  //position,
  ship: u16=0;
  hand: u8[]=[ 0, 1, 2];
  arsenal: u8[]=[];
  //log,
  state: u8=<u8>PLAYER_STATES.JOINED;
  wins: u8=0;
};

@nearBindgen
export class GameAccount {
  ships: u16[]=[];
  credits: u8=0;
  player: Player|null=null;
  inQueue: i16=-1;
};

@nearBindgen
export class Game {
  id: u16=0;
  state: u8=0;
  totalPlayers: u8=0;
  waitingPlayers: u8=0;
  playersReady: u8=0;
  round: u8=0;
};

@nearBindgen
export class BattleLogRecord {
  playerA:u8 = 0;
  playerB:u8 = 0;
  shipA:u16 = 0;
  shipB:u16 = 0;
  arsenalA:u8[] = [];
  arsenalB:u8[] = [];
  winner:u8 = 0;
  rounds:u8[][][] = [];
}

// croncat model
@nearBindgen
export class Task {
  contract_id: string;
  function_id: string;
  cadence: string;
  recurring: bool;
  deposit: u128;
  gas: u128;
  arguments: u8[];
}
