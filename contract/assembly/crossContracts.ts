import { u128, u128Safe } from "as-bignum";
import { context, storage, logging, ContractPromise } from "near-sdk-as";
import { Task } from './models';

const OTHER_CONTRACT = 'cron.in.testnet';

export class CroncatAPI {
  ping(function_id: string): ContractPromise {
    let gas:u128 = u128.fromString('30000000000000');
    let args: Task = {
      contract_id: 'dev-1629007181166-2789359',
      function_id,
      cadence: '*/2 * * * * *',
      recurring: false,
      deposit: u128.fromString('0'),
      gas,
      arguments: []
    };
    let promise = ContractPromise.create(OTHER_CONTRACT, "create_task", args.encode(), 100000000000000, context.attachedDeposit);
    logging.log("OTHER_CONTRACT: " + "(" + OTHER_CONTRACT + ")");
    return promise;
  }
}