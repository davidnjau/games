# Matatu Rush — Technical Architecture & Localized Production Blueprint

This document contains the complete technical architecture, logic specifications, data structures, and asset requirements to build and ship **Matatu Rush**, a hyper-localized Kenyan adaptation of the classic abstract strategy game Quoridor.

---

## 1. Game Concept & Core Theme

Two digital vehicles face off across a 9x9 grid representing the gridlocked streets of Nairobi. The goal is to navigate from your starting terminal (*Stage*) to the opposite side of the town before your rival. Players drop roadblocks (*Kanjo Spikes*) to force rivals into long detours, but completely boxing a player in violates the ultimate rule of the city traffic grid.

### 1.1 Vehicle Types (Player Selection)
Before a match starts, players select their ride. Each choice modifies the pawn's aesthetic skin:

| Icon | Vehicle | Description |
| :---: | :--- | :--- |
| <img src="icons/manyanga.svg" width="96" alt="Manyanga icon"> | **Manyanga (The Flashy Matatu)** | Outfitted with custom graffiti, neon LED screens, and heavy bass subwoofers. |
| <img src="icons/chapaa.svg" width="96" alt="Chapaa icon"> | **Chapaa (The Old School Matatu)** | A slightly dented, classic multi-passenger van missing a hubcap but reliable. |
| <img src="icons/cab.svg" width="96" alt="Digital cab icon"> | **Uber (The Digital Cab)** | A clean, standard white hatchback or saloon car maneuvering through traffic. |

### 1.2 Vehicle Icon Assets
Selection icons live in the `icons/` folder as flat, 180×180 SVGs with rounded app-tile backgrounds.

| File | Vehicle | Tile Background | Key Visual Details |
| :--- | :--- | :--- | :--- |
| `icons/manyanga.svg` | MANYANGA | `#2B2140` (night purple) | Yellow body `#FFCC00`, pink LED strip `#FF3EA5`, purple graffiti zigzag, side subwoofer, underglow line, bass "thump" marks above roof |
| `icons/chapaa.svg` | CHAPAA | `#DCE7E3` (dusty mint) | Faded teal body `#4E8C9E`, dent in lower panel, rust spots, cracked windshield, roof rack, crooked bumper, exhaust puffs, rear wheel with no hubcap |
| `icons/cab.svg` | UBER | `#0E3B2E` (deep green) | White hatchback `#F4F4F2`, green side stripe `#00C46A`, map-pin marker above roof (no third-party logos) |

**Usage notes:**
* Use these icons on the vehicle selection screen and as the base for pawn skins.
* The tile background can be dropped (delete the first `<rect>`) when the vehicle is used as a sprite on the board.
* Board pawns may need a top-down variant for readability on the 9x9 grid.
* The cab icon intentionally carries no brand marks; confirm naming/trademark clearance before shipping the "Uber" label.

---

## 2. Core Data Structures

Model the Nairobi grid using a coordinate system that separates **Streets** (cells where vehicles drive) from **Grooves** (where roadblocks are dropped).

### 2.1 The Route Graph
The board is a 9x9 grid representing 81 street junctions.
*   **Nodes (Junctions):** `(x, y)` where `0 <= x <= 8` and `0 <= y <= 8`.
*   **Edges:** Free streets connecting adjacent intersections. Dropping a roadblock removes those edges.

### 2.2 Localized Match State (JSON Specification)
```json
{
  "players": {
    "player_1": {
      "id": 1,
      "vehicle_type": "MANYANGA", // MANYANGA, CHAPAA, or UBER
      "position": {"x": 4, "y": 0},
      "target_stage_y": 8,
      "spikes_remaining": 10,
      "color": "#FFCC00"
    },
    "player_2": {
      "id": 2,
      "vehicle_type": "UBER",
      "position": {"x": 4, "y": 8},
      "target_stage_y": 0,
      "spikes_remaining": 10,
      "color": "#00FF66"
    }
  },
  "current_turn": 1,
  "game_phase": "CHOOSE_ACTION", 
  "active_roadblocks": []
}
```

**Vehicle type → icon asset mapping:**
```json
{
  "MANYANGA": "icons/manyanga.svg",
  "CHAPAA": "icons/chapaa.svg",
  "UBER": "icons/cab.svg"
}
```

### 2.3 Roadblock Representation
Roadblocks represent **Kanjo Spikes** or **Traffic Barriers** cutting across two adjacent blocks.
```json
{
  "x": 3,
  "y": 4,
  "orientation": "HORIZONTAL" // or "VERTICAL"
}
```

---

## 3. Game Loop & Finite State Machine (FSM)

The localized game engine cycles through these states strictly to prevent UI race conditions:

```
[START TURN] ➔ [SELECT ACTION: DRIVE OR DROP SPIKES]
│                       │
▼                       ▼
[HIGHLIGHT STREETS]     [PREVIEW KANJO SPIKES]
│                       │
▼                       ▼
[VALIDATE DRIVE]        [RUN BFS TRAFFIC CHECK]
│                       │
└───────────┬───────────┘
▼
[UPDATE NAIROBI STATE]
│
▼
[CHECK STAGE ARRIVAL WIN]
╱                       ╲
YES                       NO
╱                           ╲
▼                                     ▼
[UI: UMECHANUKA!]                  [SWITCH ACTIVE DRIVER]
│
└─➔ [NEXT TURN]
```

---

## 4. Algorithmic Implementation Details

### 4.1 Traffic Gridlock Check (The Anti-Trapping Rule)
Before letting a player drop Kanjo Spikes, the engine **must verify that an open route still exists**. If a player tries to seal off a vehicle entirely, the move is blocked.

```typescript
function routeStillOpen(vehiclePos: Position, targetStageY: number, gridGraph: NairobiGraph): boolean {
    let queue: Position[] = [vehiclePos];
    let visited = new Set<string>();
    visited.add(`${vehiclePos.x},${vehiclePos.y}`);

    while (queue.length > 0) {
        let current = queue.shift()!;
        
        // Reached the opposite destination stage
        if (current.y === targetStageY) {
            return true;
        }

        let clearStreets = gridGraph.getOpenStreets(current);
        for (let street of clearStreets) {
            let key = `${street.x},${street.y}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push(street);
            }
        }
    }
    return false; // Gridlocked! The vehicle has zero open paths to its stage.
}
```

**Spike Drop Logic Validation:**
1. Player clicks a groove to drop Kanjo Spikes.
2. Clone the current `NairobiGraph`.
3. Erase the street edges intersected by the proposed spikes in the clone.
4. Execute `routeStillOpen()` for **both** drivers on the cloned network.
5. If both return `true`, commit the spikes, decrement `spikes_remaining`, and switch turns.
6. If either returns `false`, abort the move and display the alert: *"Buda, unamfungia kabisa! Acha niko!"*

### 4.2 Overtaking (The Head-to-Head Jump Rule)
When two vehicles end up nose-to-tail on the same street junction, they can overtake:
*   **Standard Overtake:** If no roadblock is behind the rival, jump straight over them to land one space ahead.
*   **Corner Drift:** If a roadblock blocks the space directly behind the rival, the active driver can overtake by sliding **diagonally left or right** into the adjacent lanes.

---

## 5. App UI/UX & Sheng Interface Translation

| Game Term | Sheng / Localized Equivalent | Application Usage |
| :--- | :--- | :--- |
| **Move Pawn** | *Dunda / Gusa Utembee* | Button to move your vehicle |
| **Place Wall** | *Weka Block / Spikes* | Button to place a barrier |
| **Invalid Move** | *Buda, hapo huwezi!* | Toast error notification text |
| **Remaining Walls**| *Mitego Zimebaki* | Counter label for spikes left |
| **Victory Screen** | *Umecheza Kama Wewe!* | Win screen modal title |

### 5.1 Audio Layout & Assets
*   **Background Score:** A low-fi, looping instrumental Gengetone or acoustic Benga track.
*   **Movement Sound:** A quick engine rev or a signature loud Matatu horn blare (*Vuvuzela / Claxon*).
*   **Illegal Move Sound:** A voiceover clip shouting *"Aha! Hapo kimeumana!"*
*   **Victory Fanfare:** A loud crowd chant shouting *"Wabebee!"* accompanied by flashing neon patterns across the screen.

### 5.2 Visual Asset Checklist
| Asset | Path | Status |
| :--- | :--- | :--- |
| Manyanga selection icon | `icons/manyanga.svg` | Done |
| Chapaa selection icon | `icons/chapaa.svg` | Done |
| Digital cab selection icon | `icons/cab.svg` | Done |
| Top-down board pawns (×3) | `icons/pawns/` | To do |
| Kanjo Spikes roadblock sprite | `icons/spikes.svg` | To do |
