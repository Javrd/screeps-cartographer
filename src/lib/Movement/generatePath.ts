import { config } from 'config';
import { MoveOpts, MoveTarget } from '../';
import { mutateCostMatrix } from '../CostMatrixes';
import { findRoute } from '../WorldMap/findRoute';

/**
 * Generates a path with PathFinder.
 */
export function generatePath(origin: RoomPosition, targets: MoveTarget[], opts?: MoveOpts): RoomPosition[] | undefined {
  // Generate full opts object
  let actualOpts = {
    ...config.DEFAULT_MOVE_OPTS,
    ...opts
  };

  // Dynamic choose weight for roads, plains and swamps depending on body.
  if (opts?.creepMovementInfo) {
    actualOpts = { ...actualOpts, ...defaultTerrainCosts(opts.creepMovementInfo) };
  }

  // check if we need a route to limit search space
  const exits = Object.values(Game.map.describeExits(origin.roomName));
  let rooms: string[] | undefined = undefined;
  if (!targets.some(({ pos }) => pos.roomName === origin.roomName)) {
    // if there are multiple rooms in `targets`, pick the cheapest route
    const targetRooms = targets.reduce(
      (rooms, { pos }) => (rooms.includes(pos.roomName) ? rooms : [pos.roomName, ...rooms]),
      [] as string[]
    );
    for (const room of targetRooms) {
      const route = findRoute(origin.roomName, room, actualOpts);
      if (route && (!rooms || route.length < rooms.length)) {
        rooms = route;
      }
    }
    // console.log('generated path from', origin.roomName, 'to', targetRooms, ':', rooms);
  }
  // generate path
  const result = PathFinder.search(origin, targets, {
    ...actualOpts,
    maxOps: Math.min(actualOpts.maxOps ?? 100000, (actualOpts.maxOpsPerRoom ?? 2000) * (rooms?.length ?? 1)),
    roomCallback(room) {
      if (rooms && !rooms.includes(room)) return false; // outside route search space
      let cm = actualOpts.roomCallback?.(room);
      if (cm === false) return cm;
      const cloned = cm instanceof PathFinder.CostMatrix ? cm.clone() : new PathFinder.CostMatrix();
      return mutateCostMatrix(cloned, room, actualOpts);
    }
  });
  if (!result.path.length || result.incomplete) return undefined;

  return result.path;
}

function defaultTerrainCosts(
  creepInfo: Required<MoveOpts>['creepMovementInfo']
): Required<Pick<MoveOpts, 'roadCost' | 'plainCost' | 'swampCost'>> {
  const result = {
    roadCost: config.DEFAULT_MOVE_OPTS.roadCost || 1,
    plainCost: config.DEFAULT_MOVE_OPTS.plainCost || 2,
    swampCost: config.DEFAULT_MOVE_OPTS.swampCost || 10
  };

  let totalCarry = creepInfo.usedCapacity;

  let moveParts = 0;
  let usedCarryParts = 0;
  let otherBodyParts = 0;

  // Iterating right to left because carry parts are filled in that order.
  for (let i = creepInfo.body.length - 1; i >= 0; i--) {
    const bodyPart: BodyPartDefinition = creepInfo.body[i];
    if (bodyPart.type !== MOVE && bodyPart.type !== CARRY) {
      otherBodyParts++;
    } else if (bodyPart.hits <= 0) {
      continue;
    } else if (bodyPart.type === MOVE) {
      let boost = 1;
      if (bodyPart.boost) {
        boost = BOOSTS[MOVE][bodyPart.boost].fatigue;
      }
      moveParts += 1 * boost;
    } else if (totalCarry > 0 && bodyPart.type === CARRY) {
      let boost = 1;
      if (bodyPart.boost) {
        boost = BOOSTS[CARRY][bodyPart.boost].capacity;
      }
      // We count carry parts used by removing the capacity used by them from the total that the creep is carrying.
      // When total is empty, resting carry parts doesn't generate fatigue (even if they have no hits).
      totalCarry -= CARRY_CAPACITY * boost;
      usedCarryParts++;
    }
  }

  // If no move parts it can't move, skip and apply defaults to speed this up.
  if (moveParts > 0) {
    const fatigueFactor = usedCarryParts + otherBodyParts;
    const recoverFactor = moveParts * 2;

    // In case cost is 0 (only move parts), all terrains will cost 1.
    // Hardcoding 0.1 as minimum cost to obtain this result.
    const cost = Math.max(fatigueFactor / recoverFactor, 0.1);

    // Number of ticks that it takes move over each terrain.
    // Having this as a separated function could be interesting for obtaining how many ticks
    // it will take a creep to walk over a route with determined terrains.
    const roadCost = Math.ceil(cost);
    const plainCost = Math.ceil(cost * 2);
    const swampCost = Math.ceil(cost * 10);

    // Greatest common divisor.
    // https://github.com/30-seconds/30-seconds-of-code/blob/master/snippets/gcd.md
    const gcd = (...arr: number[]) => {
      const _gcd = (x: number, y: number): number => (!y ? x : gcd(y, x % y));
      return [...arr].reduce((a, b) => _gcd(a, b));
    };

    // Calculate the greatest common divisor so we can reduce the costs to the smallest numbers possible.
    const norm = gcd(roadCost, plainCost, swampCost);

    // Normalize and set the default costs. This costs are going to be always under the 255 limit.
    // Worst scenario is with 49 not move body parts and only 1 move part. This means a cost of 24.5,
    // implying 25 / 49 / 245 costs for each terrain.
    result.roadCost = roadCost / norm;
    result.plainCost = plainCost / norm;
    result.swampCost = swampCost / norm;
  }
  return result;
}
