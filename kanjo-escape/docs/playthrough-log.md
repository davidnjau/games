# Kanjo Escape — Core Playthrough Simulation & Turn Log

This document provides a comprehensive, end-to-end trace log of a single match of **Kanjo Escape**. It serves as a technical walkthrough for QA testers and developer engineers to map game loops, hidden variable transitions, and audio-visual triggers.

---

## 1. Match Initialization Parameters

### 1.1 The Hawker Profile (Player 1)
*   **True Start Position:** `node_river_rd_mid` (Hidden from UI)
*   **Inventory Load:** `MEDIUM_LOAD` (Allows exactly 1 node movement step per turn; permits entry into `HAWKER_ALLEY` nodes).
*   **Win Objective:** Reach either `stage_archives` or `stage_khoja`.

### 1.2 The Kanjo Squad Profile (Player 2)
*   **Active Units:** 3 public pieces deployed at baseline corners.
    *   `askari_1` (Pickup Truck): Starting at `node_tom_haile` (Movement range: 2 nodes, main roads only).
    *   `askari_2` (On Foot): Starting at `node_tom_ronald` (Movement range: 1 node, can enter alleys).
    *   `askari_3` (Pickup Truck): Starting at `stage_machakos` (Movement range: 2 nodes, main roads only).

---

## 2. Turn-by-Turn Execution Log

### ── TURN 1 ──
#### Hawker Phase (Secret Input)
*   **System Action Message:** UI flashes text: *"Ficha mzigo! Sonka chap chap kabla wakuone."*
*   **Player Input:** Selects adjacent node `node_river_rd_entry`.
*   **Backend Verification:** Node path is checked via the graph layout. Path is clear.
*   **State Matrix Update:** 
    ```json
    "hawker.true_position": "node_river_rd_entry",
    "hawker.turns_since_reveal": 1
    ```
*   **Kanjo Screen View:** Hawker node remains completely invisible.

#### Kanjo Squad Phase (Public Inputs)
*   **Player Input (Unit 1):** Moves `askari_1` two blocks north along Tom Mboya St to `node_moi_kenyatta` to seal off the upper boulevard.
*   **Player Input (Unit 2):** Marches `askari_2` one block west onto `node_tom_ronald` to cover the lower perimeter.

---

### ── TURN 2 ──
#### Hawker Phase (Secret Input)
*   **Situation:** The Hawker observes `stage_khoja` is completely open but spots the Kanjo pickup truck looming closely on the edge of the screen. 
*   **Player Input:** Taps on the adjacent narrow groove: **`alley_biashara_cut`**.
*   **State Matrix Update:** 
    ```json
    "hawker.true_position": "alley_biashara_cut",
    "hawker.turns_since_reveal": 2
    ```

#### Kanjo Squad Phase (Public Inputs)
*   **Player Input (Unit 1):** Drives `askari_1` down one junction to `node_moi_muranga`. *(Developer Note: The truck is now positioned directly outside the mouth of the alley).*
*   **Player Input (Unit 3):** Dispatches `askari_3` straight to `node_river_rd_entry` to close down the lane.
*   **Tactical Overview:** The Kanjo player has successfully secured both exits of the main avenue, completely unaware that the Hawker has safely bypassed them inside the middle alley node.

---

### ── TURN 3 ──
#### Hawker Phase (Secret Input)
*   **Situation:** The Hawker steps out from the other side of the alley, landing directly on **`node_moi_muranga`**. 
*   **Collision Engine Evaluation:** The server runs a proximity intercept check: `hawker.true_position === askari_1.position`. *True.*
*   **Overtake Rule Execution:** The engine detects that the street node directly behind the vehicle (`node_moi_kenyatta`) is unoccupied and free of roadblocks. The **Standard Overtake Rule** triggers automatically.
*   **State Matrix Update:** The Hawker vaults straight over the truck, updating position variables instantly:
    ```json
    "hawker.true_position": "node_moi_kenyatta",
    "hawker.turns_since_reveal": 3
    ```

#### Kanjo Squad Phase (Public Inputs)
*   **Player Input (Unit 1):** Assuming the Hawker ran north toward the bus terminals, the Kanjo player blindly moves `askari_1` to `stage_khoja`. *(Total miss).*

---

### ── TURN 4 ──
#### System Automatic Ping Event
*   **Engine Rule Check:** `turn_counter % 4 === 0`. *True.*
*   **UI System Broadcast:** A bright neon orange radar circle pulses on the game board. 
*   **Audio SFX Trigger:** Audio channel plays the signature whistle blow voiceover: 🔊 *"Wale wale!"*
*   **Public Display:** The Kanjo UI map temporarily highlights the Hawker's exact location at `node_moi_kenyatta`.

#### Hawker Phase (Publicly Exposed Input)
*   **Player Input:** Rushes down the clear avenue lane straight to `node_tom_kenya_re`.

#### Kanjo Squad Phase (Panic Chase Turn)
*   **Player Input (Unit 1):** Speeds `askari_1` down Moi Avenue directly to `node_moi_kenyatta` to trail the target.
*   **Player Input (Unit 2):** Repositions `askari_2` down to `node_tom_ronald` to form a defensive wall.

---

### ── TURN 5 ──
#### Hawker Phase (The Escape Sprint)
*   **Situation:** The Hawker stands at `node_tom_kenya_re`. The adjacent node option includes `stage_archives`, which matches a tagged `STAGE_ESCAPE` type terminal profile.
*   **Player Input:** Taps on the bright green `stage_archives` button icon.
*   **Win Validation Check:** Engine checks target node type. Win conditions confirmed.

---

## 3. Post-Game Win Screen Resolution

Immediately upon terminal node detection, the core game engine drops all ongoing touch interface listener loops and launches the victory layout sequence:

*   **UI Banner Text Modal:** Displays the congratulations header in massive, bold typography: **"UMECHAPA ESCAPE!"**
*   **Sub-Header Text:** *"Umecheza kama wewe boss! Mizigo iko salama."* (You played exactly like yourself boss! The inventory is safe.)
*   **Audio Channel Asset:** Plays a celebratory loop of crowd cheers chanting 🔊 *"Wabebee!"* overlayed with a rhythmic acoustic Benga string loop.
*   **Interactive Options:** Renders two centralized buttons: `[ Cheza Tena (Rematch) ]` and `[ Menu Kuu (Main Menu) ]`.