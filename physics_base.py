from enum import Enum
import pandas as pd

from typing import Any

import math

PLAYER_RADIUS = 0.6103515625
BALL_RADIUS = 0.9765625


class PossessionType(Enum):
    """Types of ball possession."""

    RED = "red"
    BLUE = "blue"
    NEUTRAL = "neutral"


class PassResult(Enum):
    """Results of pass detection."""

    SUCCESSFUL_PASS = "pass"
    MISSED_PASS = "missed_pass"
    LOSS_OF_POSSESSION = "loss_of_possession"


class ShotResult(Enum):
    """Results of shot detection."""

    GOAL = "goal"
    SAVE = "save"
    MISS = "miss"


class AccumulationType(Enum):
    """Types of accumulation for statistics."""

    SUM = "sum"
    AVERAGE = "average"
    DISTRIBUTION = "distribution"  # For position/index distributions with percentage output


# Configuration
TOUCH_THRESHOLD = 1.1  # Distance for an "uncontested touch"
CLOSE_THRESHOLD = 4.0  # Distance for "closeness"
REQUIRED_CLOSE_FRAMES = 120  # Approx 2 seconds at 60fps

BALL_RAD = 0.9765625
PLAYER_RAD = 0.6103515625
BALL_PLAYER_APPROX = 1.59

STATE_CONTAINER = {}  # Global state container for accumulation functions

# Goal box boundaries (blue goal at X=0, red goal at X=100)
# Goal is roughly 18 units wide centered at Y=28.125
BLUE_GOAL_BOX = {
    "x_relax": 8.7,
    "x_strict": 8.7,
    "y1_strict": 23.5,
    "y2_strict": 32.75,
    "y1_relax": 19.25,
    "y2_relax": 37,
}  # Blue defends left
RED_GOAL_BOX = {
    "x_relax": 91.3,
    "x_strict": 91.3,
    "y1_strict": 23.5,
    "y2_strict": 32.75,
    "y1_relax": 19.25,
    "y2_relax": 37,
}  # Red defends right

BOOST_POSITIONS = [
    (15.696192, 47.998825),
    (15.696192, 8.251172),
    (14.100928, 28.125),
    (35.927097, 34.41909),
    (35.927097, 21.83091),
    (50, 50.166016),
    (50, 34.41909),
    (50, 21.83091),
    (50, 6.0839844),
    (64.0729, 34.41909),
    (64.0729, 21.83091),
    (84.30381, 47.998825),
    (85.85269, 28.125),
    (84.30381, 8.251172),
]
BOOST_PICKUP_RADIUS = 3.0
SAVE_VELOCITY_MULTIPLIER = 9.0  # Cone half-angle = multiplier / speed; higher = wider cones
COLLISION_THRESHOLD = 0.001  # Collision detection threshold (distance helpers account for radii)

# Map wall hitbox data - each border is a polyline of (x, y) coordinate pairs
MAP_BORDERS = [
    [
        4.345703,
        23.4375,
        7.8125,
        23.4375,
        8.747321,
        23.065054,
        9.35389,
        22.033329,
        9.3727455,
        21.784855,
        9.375,
        15.625,
        9.419886,
        14.341579,
        9.554507,
        13.087652,
        9.77882,
        11.872826,
        10.092774,
        10.70671,
        10.496322,
        9.598909,
        10.989413,
        8.559029,
        11.572,
        7.5966754,
        12.244037,
        6.721461,
        13.005472,
        5.942987,
        13.856259,
        5.270861,
        14.796352,
        4.7146916,
        15.825697,
        4.284084,
        16.944252,
        3.988645,
        18.151962,
        3.8379812,
        18.762207,
        3.819908,
        34.470215,
        3.9541852,
        50.3125,
        3.880943,
    ],
    [
        95.6543,
        23.4375,
        92.1875,
        23.4375,
        91.252686,
        23.065052,
        90.64611,
        22.033329,
        90.62726,
        21.784855,
        90.625,
        15.625,
        90.58011,
        14.341579,
        90.44549,
        13.087652,
        90.221176,
        11.872826,
        89.90722,
        10.70671,
        89.50368,
        9.598909,
        89.01059,
        8.559029,
        88.427986,
        7.5966754,
        87.75597,
        6.721461,
        86.99453,
        5.942987,
        86.14373,
        5.270861,
        85.20364,
        4.7146916,
        84.17429,
        4.284084,
        83.05575,
        3.988645,
        81.84804,
        3.8379812,
        81.23779,
        3.819908,
        65.529785,
        3.9541852,
        49.6875,
        3.880943,
    ],
    [
        4.345703,
        32.8125,
        7.8125,
        32.8125,
        8.747321,
        33.18495,
        9.35389,
        34.21667,
        9.3727455,
        34.465145,
        9.375,
        40.625,
        9.419886,
        41.90842,
        9.554507,
        43.162342,
        9.77882,
        44.377174,
        10.0927725,
        45.543278,
        10.49632,
        46.651093,
        10.989413,
        47.690975,
        11.572,
        48.65332,
        12.244035,
        49.528538,
        13.005472,
        50.30701,
        13.856258,
        50.979137,
        14.796349,
        51.535305,
        15.825697,
        51.965916,
        16.94425,
        52.261356,
        18.151962,
        52.412018,
        18.762207,
        52.430096,
        34.470215,
        52.29581,
        50.3125,
        52.369057,
    ],
    [
        95.6543,
        32.8125,
        92.1875,
        32.8125,
        91.252686,
        33.18495,
        90.64611,
        34.21667,
        90.62726,
        34.465145,
        90.625,
        40.625,
        90.58011,
        41.90842,
        90.44549,
        43.162342,
        90.221176,
        44.377174,
        89.90721,
        45.543278,
        89.50368,
        46.651093,
        89.01059,
        47.690975,
        88.42799,
        48.65332,
        87.75596,
        49.528538,
        86.99452,
        50.30701,
        86.14374,
        50.979137,
        85.20364,
        51.535305,
        84.1743,
        51.965916,
        83.05575,
        52.261356,
        81.84804,
        52.412018,
        81.23779,
        52.430096,
        65.529785,
        52.29581,
        49.6875,
        52.369057,
    ],
    [4.375, 23.4375, 4.375, 32.8125],
    [95.50781, 23.4375, 95.50781, 32.8125],
]


def _parse_wall_segments(
    borders: list[list[float]],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Parse flat coordinate arrays into line segment tuples."""
    segments = []
    for border in borders:
        points = [(border[i], border[i + 1]) for i in range(0, len(border), 2)]
        for i in range(len(points) - 1):
            segments.append((points[i], points[i + 1]))
    return segments


WALL_SEGMENTS = _parse_wall_segments(MAP_BORDERS)


def point_to_segment_distance(
    px: float, py: float, x1: float, y1: float, x2: float, y2: float
) -> float:
    """Calculate minimum distance from point (px, py) to line segment (x1,y1)-(x2,y2)."""
    dx, dy = x2 - x1, y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_sq))
    closest_x = x1 + t * dx
    closest_y = y1 + t * dy
    return ((px - closest_x) ** 2 + (py - closest_y) ** 2) ** 0.5


def frames_to_time(frame_count: int, fps: int = 60) -> str:
    """Convert frame count to time string in seconds."""
    seconds = frame_count / fps
    minutes = int(seconds // 60)
    seconds = int(seconds % 60)
    return f"{minutes}:{seconds:02d}"


def ball_to_player_distance(
    ball_x: float, ball_y: float, player_x: float, player_y: float
) -> float:
    center_to_center = math.sqrt((player_x - ball_x) ** 2 + (player_y - ball_y) ** 2)
    outer = center_to_center - BALL_RADIUS - PLAYER_RADIUS
    return outer


def player_to_player_distance(
    player1_x: float, player1_y: float, player2_x: float, player2_y: float
) -> float:
    center_to_center = math.sqrt((player1_x - player2_x) ** 2 + (player1_y - player2_y) ** 2)
    outer = center_to_center - 2 * PLAYER_RADIUS
    return outer


def central_distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


def to_meters(game_units: float) -> float:
    return game_units * (50 / 36)


def aims_between_points_2d(
    origin: tuple[float, float],
    velocity: tuple[float, float],
    point1: tuple[float, float],
    point2: tuple[float, float],
) -> bool:
    """
    Check if a velocity vector aims between two points in 2D (forward only).

    Args:
        origin: Starting point [x, y]
        velocity: Direction vector [vx, vy]
        point1: First point [x, y]
        point2: Second point [x, y]

    Returns:
        bool: True if velocity aims between the two points (in the forward direction)
    """
    # Vectors from origin to each point
    to_p1 = [point1[0] - origin[0], point1[1] - origin[1]]
    to_p2 = [point2[0] - origin[0], point2[1] - origin[1]]

    # Check if velocity aims forward toward both points (dot product > 0)
    dot1 = velocity[0] * to_p1[0] + velocity[1] * to_p1[1]
    dot2 = velocity[0] * to_p2[0] + velocity[1] * to_p2[1]

    # If either point is behind the velocity direction, return False
    if dot1 <= 0 and dot2 <= 0:
        return False

    # 2D cross products to check angular wedge
    cross1 = velocity[0] * to_p1[1] - velocity[1] * to_p1[0]
    cross2 = velocity[0] * to_p2[1] - velocity[1] * to_p2[0]

    # Velocity is between the two vectors if cross products have opposite signs
    return cross1 * cross2 <= 0


def is_in_velocity_cone(
    point: tuple[float, float],
    apex: tuple[float, float],
    velocity: tuple[float, float],
    velocity_multiplier: float,
) -> bool:
    """
    Check if a point falls within a cone defined by position and velocity.
    The cone extends from apex in the direction of velocity, with half-angle
    that scales inversely with velocity magnitude (faster = narrower cone).

    half_angle = velocity_multiplier / speed (in radians, capped at pi)
    """
    speed = (velocity[0] ** 2 + velocity[1] ** 2) ** 0.5
    if speed < 0.001:
        return True  # No velocity → cone covers everything

    half_angle = min(velocity_multiplier / speed, math.pi)

    # Vector from apex to point
    dx = point[0] - apex[0]
    dy = point[1] - apex[1]
    dist = (dx**2 + dy**2) ** 0.5
    if dist < 0.001:
        return True  # Point is at the apex

    # Angle between velocity direction and direction to point
    cos_angle = (dx * velocity[0] + dy * velocity[1]) / (dist * speed)
    cos_angle = max(-1.0, min(1.0, cos_angle))
    angle = math.acos(cos_angle)

    return angle <= half_angle


def time_from_tick(tick: int) -> str:
    # Calculate MM:SS
    tick_remaining_seconds = 300 - tick / 60
    abs_seconds = abs(tick_remaining_seconds)
    time_str = f"{int(abs_seconds // 60)}:{int(abs_seconds % 60):02d}"
    if tick_remaining_seconds < 0:  # overtime
        time_str = f"+{time_str}"
    return time_str


def preprocess_frame_physics(
    row: pd.Series,
    shared_states: dict[str, Any],
    num_players: int,
    blue_players: list[int],
    red_players: list[int],
) -> None:
    """
    Pre-compute all physics-related calculations for a single frame.

    Populates shared_states["physics"] with pre-computed values that
    accumulator functions can read instead of computing independently.
    Maintains persistent touch-tracking state in shared_states["_physics_state"].

    Pre-computed values:
    - Ball and player positions, velocities, speeds
    - Ball-to-player distances (raw and in meters)
    - Per-team minimum distances to ball
    - Touch detection (current touching players, new touches this frame)
    - Ball trajectory checks (aiming at goals, strict and relaxed)
    - Velocity cone membership for all players
    - Player-player collision detection
    - Ball-in-goal checks
    """
    physics_state = shared_states.setdefault("_physics_state", {})

    blue_set = set(p for p in blue_players if p < num_players)
    red_set = set(p for p in red_players if p < num_players)
    all_valid = sorted(blue_set | red_set)

    # Ball state
    ball_x, ball_y = row["Ball_Pos_X"], row["Ball_Pos_Y"]
    ball_vel_x, ball_vel_y = row["Ball_Vel_X"], row["Ball_Vel_Y"]
    ball_pos = (ball_x, ball_y)
    ball_vel = (ball_vel_x, ball_vel_y)
    ball_speed_kmh = (ball_vel_x**2 + ball_vel_y**2) ** 0.5 * 5

    # Player state
    player_positions: dict[int, tuple[float, float]] = {}
    player_velocities: dict[int, tuple[float, float]] = {}
    player_speeds_kmh: dict[int, float] = {}

    for pid in all_valid:
        px, py = row[f"P{pid}_Pos_X"], row[f"P{pid}_Pos_Y"]
        vx, vy = row[f"P{pid}_Vel_X"], row[f"P{pid}_Vel_Y"]
        player_positions[pid] = (px, py)
        player_velocities[pid] = (vx, vy)
        player_speeds_kmh[pid] = (vx**2 + vy**2) ** 0.5 * 5

    # Ball-to-player distances (already accounts for radii)
    ball_distances: dict[int, float] = {}
    ball_distances_m: dict[int, float] = {}
    for pid in all_valid:
        px, py = player_positions[pid]
        dist = ball_to_player_distance(ball_x, ball_y, px, py)
        ball_distances[pid] = dist
        ball_distances_m[pid] = to_meters(dist)

    # Per-team minimum distances
    blue_dists = [ball_distances[p] for p in blue_set]
    red_dists = [ball_distances[p] for p in red_set]
    min_blue_dist = min(blue_dists) if blue_dists else float("inf")
    min_red_dist = min(red_dists) if red_dists else float("inf")

    # Ball trajectory - aiming at goals (strict and relaxed)
    ball_aims_at_red_goal_strict = aims_between_points_2d(
        ball_pos,
        ball_vel,
        (RED_GOAL_BOX["x_strict"], RED_GOAL_BOX["y1_strict"]),
        (RED_GOAL_BOX["x_strict"], RED_GOAL_BOX["y2_strict"]),
    )
    ball_aims_at_red_goal_relax = aims_between_points_2d(
        ball_pos,
        ball_vel,
        (RED_GOAL_BOX["x_relax"], RED_GOAL_BOX["y1_relax"]),
        (RED_GOAL_BOX["x_relax"], RED_GOAL_BOX["y2_relax"]),
    )
    ball_aims_at_blue_goal_strict = aims_between_points_2d(
        ball_pos,
        ball_vel,
        (BLUE_GOAL_BOX["x_strict"], BLUE_GOAL_BOX["y1_strict"]),
        (BLUE_GOAL_BOX["x_strict"], BLUE_GOAL_BOX["y2_strict"]),
    )
    ball_aims_at_blue_goal_relax = aims_between_points_2d(
        ball_pos,
        ball_vel,
        (BLUE_GOAL_BOX["x_relax"], BLUE_GOAL_BOX["y1_relax"]),
        (BLUE_GOAL_BOX["x_relax"], BLUE_GOAL_BOX["y2_relax"]),
    )

    # Velocity cone - which players are in the ball's path
    players_in_ball_cone: dict[int, bool] = {}
    for pid in all_valid:
        players_in_ball_cone[pid] = is_in_velocity_cone(
            player_positions[pid], ball_pos, ball_vel, SAVE_VELOCITY_MULTIPLIER
        )

    # Ball-in-goal checks
    ball_in_red_goal = (
        ball_x >= RED_GOAL_BOX["x_strict"]
        and RED_GOAL_BOX["y1_strict"] <= ball_y <= RED_GOAL_BOX["y2_strict"]
    )
    ball_in_blue_goal = (
        ball_x <= BLUE_GOAL_BOX["x_strict"]
        and BLUE_GOAL_BOX["y1_strict"] <= ball_y <= BLUE_GOAL_BOX["y2_strict"]
    )

    # --- Unified collision detection ---
    # All contacts (ball-player and player-player) are tracked as collisions.
    # "Touch" = ball-player collision. Both use the same prev/new logic.
    # Impact events are recorded on the next frame after measuring velocity changes.
    frame = row["Frame"]
    collision_events: list[dict[str, Any]] = shared_states.setdefault("_collision_events", [])

    # Detect all current collisions
    current_collisions: list[dict[str, Any]] = []
    current_collision_pairs: set[tuple[str | int, str | int]] = set()

    # Ball-player collisions (dist < 0.01 = surfaces touching)
    for pid in all_valid:
        if ball_distances[pid] < 0.01:
            pair: tuple[str | int, int] = ("ball", pid)
            current_collision_pairs.add(pair)
            current_collisions.append(
                {
                    "obj1": "ball",
                    "obj2": pid,
                    "type": "ball_player",
                    "distance": ball_distances[pid],
                }
            )

    # Player-player collisions (all pairwise, using outer-surface distance)
    for i in range(len(all_valid)):
        for j in range(i + 1, len(all_valid)):
            p1, p2 = all_valid[i], all_valid[j]
            pos1, pos2 = player_positions[p1], player_positions[p2]
            dist = player_to_player_distance(pos1[0], pos1[1], pos2[0], pos2[1])
            if dist < COLLISION_THRESHOLD:
                pair = (min(p1, p2), max(p1, p2))
                current_collision_pairs.add(pair)
                current_collisions.append(
                    {"obj1": p1, "obj2": p2, "type": "player_player", "distance": dist}
                )

    # Ball-wall collisions (distance from ball surface to wall segment)
    for seg_idx, ((wx1, wy1), (wx2, wy2)) in enumerate(WALL_SEGMENTS):
        dist = point_to_segment_distance(ball_x, ball_y, wx1, wy1, wx2, wy2) - BALL_RAD
        if dist < COLLISION_THRESHOLD:
            wall_pair: tuple[str | int, str | int] = ("ball", f"wall_{seg_idx}")
            current_collision_pairs.add(wall_pair)
            current_collisions.append(
                {
                    "obj1": "ball",
                    "obj2": f"wall_{seg_idx}",
                    "type": "ball_wall",
                    "distance": dist,
                }
            )

    # Determine new vs continuing collisions
    prev_collision_pairs = physics_state.get("prev_collision_pairs", set())
    new_collisions = [
        c
        for c in current_collisions
        if (
            ("ball", c["obj2"])
            if c["type"] == "ball_player"
            else (min(c["obj1"], c["obj2"]), max(c["obj1"], c["obj2"]))
        )
        not in prev_collision_pairs
    ]

    # Convenience: extract ball-player touches for downstream accumulators
    current_touching = [c["obj2"] for c in current_collisions if c["type"] == "ball_player"]
    new_touches = [c["obj2"] for c in new_collisions if c["type"] == "ball_player"]
    new_touches.sort(key=lambda pid: ball_distances[pid])

    # Convenience: extract player-player collisions
    player_collisions = [
        (c["obj1"], c["obj2"], c["distance"])
        for c in current_collisions
        if c["type"] == "player_player"
    ]

    # Convenience: extract ball-wall collisions
    ball_wall_touches = [
        (c["obj2"], c["distance"]) for c in current_collisions if c["type"] == "ball_wall"
    ]
    new_wall_touches = [c["obj2"] for c in new_collisions if c["type"] == "ball_wall"]

    # Resolve pending impacts from previous frame (measure velocity changes)
    frame_collision_events: list[dict[str, Any]] = []
    for pending in physics_state.get("pending_impacts", []):
        col_frame = pending["frame"]
        obj1, obj2 = pending["obj1"], pending["obj2"]
        obj1_vel_before, obj2_vel_before = pending["obj1_vel"], pending["obj2_vel"]

        # Get current (post-impact) velocities
        obj1_vel_after = ball_vel if obj1 == "ball" else player_velocities.get(obj1)
        if isinstance(obj2, str) and obj2.startswith("wall_"):
            obj2_vel_after: tuple[float, float] | None = (0.0, 0.0)
        else:
            obj2_vel_after = player_velocities.get(int(obj2))

        if obj1_vel_after is not None and obj2_vel_after is not None:
            obj1_dv = (
                (obj1_vel_after[0] - obj1_vel_before[0]) ** 2
                + (obj1_vel_after[1] - obj1_vel_before[1]) ** 2
            ) ** 0.5 * 5
            obj2_dv = (
                (obj2_vel_after[0] - obj2_vel_before[0]) ** 2
                + (obj2_vel_after[1] - obj2_vel_before[1]) ** 2
            ) ** 0.5 * 5

            # Hit speed: scalar projection of (other_dv) onto my_vel_before, scaled to km/h
            # proj_B(A) = (A · B) / |B|
            # Measures how much of the other's velocity change aligns with my motion.
            obj1_speed_before = (obj1_vel_before[0] ** 2 + obj1_vel_before[1] ** 2) ** 0.5
            obj1_hit_speed = (
                (
                    obj1_vel_before[0] * (obj2_vel_after[0] - obj2_vel_before[0])
                    + obj1_vel_before[1] * (obj2_vel_after[1] - obj2_vel_before[1])
                )
                / obj1_speed_before
                * 5
                if obj1_speed_before > 0
                else 0
            )
            obj2_speed_before = (obj2_vel_before[0] ** 2 + obj2_vel_before[1] ** 2) ** 0.5
            obj2_hit_speed = (
                (
                    obj2_vel_before[0] * (obj1_vel_after[0] - obj1_vel_before[0])
                    + obj2_vel_before[1] * (obj1_vel_after[1] - obj1_vel_before[1])
                )
                / obj2_speed_before
                * 5
                if obj2_speed_before > 0
                else 0
            )

            resolved_event = {
                "frame": col_frame,
                "type": pending["type"],
                "object1": obj1,
                "object2": obj2,
                "object1_impact_kmh": round(obj1_dv, 2),
                "object2_impact_kmh": round(obj2_dv, 2),
                "object1_hit_speed": round(obj1_hit_speed, 2),
                "object2_hit_speed": round(obj2_hit_speed, 2),
            }
            collision_events.append(resolved_event)
            frame_collision_events.append(resolved_event)

    # Store new collisions as pending for next-frame impact measurement
    pending_impacts: list[dict[str, Any]] = []
    for collision in new_collisions:
        obj1, obj2 = collision["obj1"], collision["obj2"]
        obj1_vel = ball_vel if obj1 == "ball" else player_velocities.get(obj1)
        if isinstance(obj2, str) and obj2.startswith("wall_"):
            obj2_vel: tuple[float, float] | None = (0.0, 0.0)
        else:
            obj2_vel = player_velocities.get(int(obj2))
        if obj1_vel is not None and obj2_vel is not None:
            pending_impacts.append(
                {
                    "type": collision["type"],
                    "obj1": obj1,
                    "obj2": obj2,
                    "obj1_vel": obj1_vel,
                    "obj2_vel": obj2_vel,
                    "frame": frame,
                }
            )

    physics_state["pending_impacts"] = pending_impacts
    physics_state["prev_collision_pairs"] = current_collision_pairs

    shared_states["physics"] = {
        "ball_pos": ball_pos,
        "ball_vel": ball_vel,
        "ball_speed_kmh": ball_speed_kmh,
        "player_positions": player_positions,
        "player_velocities": player_velocities,
        "player_speeds_kmh": player_speeds_kmh,
        "ball_distances": ball_distances,
        "ball_distances_m": ball_distances_m,
        "min_blue_dist": min_blue_dist,
        "min_red_dist": min_red_dist,
        "current_touching": current_touching,
        "new_touches": new_touches,
        # "ball_aims_at_red_goal_strict": ball_aims_at_red_goal_strict,
        # "ball_aims_at_red_goal_relax": ball_aims_at_red_goal_relax,
        # "ball_aims_at_blue_goal_strict": ball_aims_at_blue_goal_strict,
        # "ball_aims_at_blue_goal_relax": ball_aims_at_blue_goal_relax,
        # "players_in_ball_cone": players_in_ball_cone,
        "current_collisions": current_collisions,
        "new_collisions": new_collisions,
        "player_collisions": player_collisions,
        "ball_wall_touches": ball_wall_touches,
        "new_wall_touches": new_wall_touches,
        "ball_touching_wall": len(ball_wall_touches) > 0,
        "frame_collision_events": frame_collision_events,
        # "ball_in_red_goal": ball_in_red_goal,
        # "ball_in_blue_goal": ball_in_blue_goal,
        # "blue_set": blue_set,
        # "red_set": red_set,
        # "all_valid": all_valid,
    }
