//import { JSON } from "assemblyscript-json";

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
  ship: u32=0;
  hand: u8[]=[ 0, 1, 2];
  cards: u8[]=[];
  //log,
  state: u8=<u8>PLAYER_STATES.JOINED;
  wins: u8=0;
};
