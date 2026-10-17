// The APN models of Konios's case studies (Konios 2015, Sec. 2.3 and 4.5), built from a root net
// with the forward (Def. 8) and backward (Def. 12) composition operators:
//   - the Ambient Garage (Sec. 2.3.1, 4.5.1; Figs 4.13-4.15), an ambient guidance system;
//   - the Ambient Conference Room (Sec. 2.3.2, 4.5.2; Figs 4.16-4.17), an ambient information system.
// Element names are those of the Snoopy models in Figs 4.14-4.17; each element's comment says which
// sensor, display, database entry or user action it stands for. The structuring set Cl has the two
// user identities 1 and 2 (Sec. 4.5.1, 4.5.2).
//
// Readings of the figures (where the thesis text and figures disagree, the figures are followed):
// - Garage, Fig. 4.15: the transitions of the control system of A2top2 carry swapped labels (the
//   emptying transition is labelled Tr_p2_1_1). Here the emptying transitions are Tem_*, the retrieve
//   transitions Tr_*. Fig. 4.14 labels both retrieve transitions of ctrl_p1 "Tr_p1_2"; here they are
//   Tr_p1_1 and Tr_p1_2. Same for Tr_PC_area_1/2 in Fig. 4.17.
// - Conference room: the text (Sec. 4.5.2) says only action (iv) is a backward composition, but
//   Fig. 4.17 joins two steps into final_decision and into participants_see_decision_on_public_display,
//   which forward composition cannot do (it only builds trees, Sec. 4.3.1.1). Following the figure,
//   return_after_decision (action x) and announcing_decision_1 (action xii from final_decision) are
//   backward compositions; make_decision (xi) is composed before return_after_decision (x) so that
//   final_decision exists.
// - Conference room: Fig. 4.17 has two announcing transitions from final_decision (announcing_decision_1
//   and _2), each with one inhibitor arc, and they share the control system of announcing_decision
//   (ctrl_see_display with two rows). The operators cannot share a control system (Def. 12 brings the
//   one step net's own), and Sec. 4.3.2.1 forbids a second backward composition on the same gluing
//   pairs. So there is one backward step announcing_decision_1, guarded by both control places of
//   final_decision as Def. 12 prescribes, with its own control place ctrl_see_display_1. The two drawn
//   rows are split between the two control systems by the arrival they serve, as the paths of
//   Figs 7.47-7.49 show: announcing_decision is followed by Tem_see_display_1 (unauth_wait_and_see_decision),
//   announcing_decision_1/_2 by Tem_see_display_2 (auth_exit_and_see_decision). Sec. 4.1.2 sizes a
//   control system by the advices for the action of its own step. Every drawn place and transition
//   thus appears once, and the decision reached through final_decision is shown on
//   auth_exit_and_see_decision, the place named in the targets of Fig. 7.46(a, b).
// - Database places hold one token per user, as Figs 4.14-4.17 print them (e.g. db_A1_1: 1`1,
//   fir_paper: 1`1, PC_area: 1`1,2) and as Sec. 4.5.1 and the markings M0 of Sec. 6.5 state. The
//   Charlie analyses of chapter 7 print uncoloured markings (Figs 7.44-7.49: "fir_paper | ..."), so
//   there any user can take any database token; that difference is not modelled.
// - Retrieve transitions have the response place as their only pre-place (Def. 6); the thesis notes
//   that a delayed retrieve does not affect the user (Sec. 4.1.2, footnote), so no guard is added.
// - Capacities are 1 per colour (Sec. 3.2). Snoopy has no capacities; the total bound ℓ of Sec. 4.5.1 is
//   not part of the APN definition and is not modelled.

import { ColourSetDecl, Net, Point } from "@pns/core";
import { BasicStepOptions, Colour, DecisionPoint, oneStepNet, basicStepNet, rootNet } from "./blocks";
import { backwardCompose, forwardCompose, tidy } from "./compose";
import { constructTapn } from "./construction";

/** The structuring set of both case studies: user identities 1 and 2. */
export const USERS: ColourSetDecl = { name: "User", type: "int", min: 1, max: 2 };

type Row = [users: Colour[], database: string, emptying: string, response: string, retrieve: string, responseComment: string, databaseComment: string];

interface StepSpec {
  step: string;
  start: string;
  finish: string;
  control: string;
  rows: Row[];
  stepComment: string;
  finishComment?: string;
  controlComment: string;
  /** Position of a new finishing place (forward steps). */
  at?: Point;
}

function options(s: StepSpec): BasicStepOptions {
  const decisions: DecisionPoint[] = s.rows.map(([users, database, emptying, response, retrieve, responseComment, databaseComment]) => ({
    users,
    database,
    emptying,
    response,
    retrieve,
    responseComment,
    databaseComment,
  }));
  return {
    colourSet: USERS,
    start: `${s.start}'`,
    finish: s.finish,
    step: s.step,
    control: s.control,
    decisions,
    comments: { step: s.stepComment, finish: s.finishComment, control: s.controlComment },
    name: s.step,
  };
}

function fc(net: Net, s: StepSpec, avoid: Point[]): Net {
  return forwardCompose(net, s.start, basicStepNet(options(s)), { at: s.at, name: net.name, avoid });
}

function bc(net: Net, s: StepSpec, avoid: Point[]): Net {
  return backwardCompose(net, s.start, s.finish, oneStepNet({ ...options(s), start: `${s.start}'`, finish: `${s.finish}'` }), { name: net.name, avoid });
}

// ---------------------------------------------------------------------------------------------
// Ambient Garage

/** Positions of the sensor areas, after the topology of Fig. 4.13 and the drawing of Fig. 4.15. */
const GARAGE_AT: Record<string, Point> = {
  entrance: { x: 1000, y: 1700 },
  p1: { x: 1000, y: 1250 },
  A1: { x: 560, y: 1250 },
  p2: { x: 1000, y: 750 },
  A2: { x: 1440, y: 750 },
  exit: { x: 1000, y: 300 },
};

const db = (user: number | string) => `Database: data for car ${user} (bay A1 is allocated to car 1, bay A2 to car 2)`;

const GARAGE: { kind: "forward" | "backward"; spec: StepSpec }[] = [
  {
    kind: "forward",
    spec: {
      step: "access_granted",
      start: "entrance",
      finish: "p1",
      control: "ctrl_p1",
      at: GARAGE_AT.p1,
      stepComment: "Action (i): the entrance bar lifts for a car with a paid ticket, which moves from the entrance to the first junction",
      finishComment: "Sensor of the first junction",
      controlComment: "Cars detected by the first junction's sensor that have not yet been given directions there",
      rows: [
        [[1], "db_p1_1", "Tem_p1_1", "Left_p1_1", "Tr_p1_1", "Public display at the first junction: arrow to the left (towards bay A1) for car 1", db(1)],
        [[2], "db_p1_2", "Tem_p1_2", "Forward_p1_2", "Tr_p1_2", "Public display at the first junction: arrow forward (towards the second junction) for car 2", db(2)],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "p1toA1",
      start: "p1",
      finish: "A1",
      control: "ctrl_A1",
      at: GARAGE_AT.A1,
      stepComment: "Action (ii): a car moves from the first junction to parking bay A1",
      finishComment: "Sensor of parking bay A1 (scans the ID of the car parked there)",
      controlComment: "Cars detected at bay A1 that have not yet had the system's response",
      rows: [
        [[1], "db_A1_1", "Tem_A1_1", "Park_A1_1", "Tr_A1_1", "Car 1 is at its own bay: parking confirmed, the remaining time is sent to the driver's mobile device", db(1)],
        [[2], "db_A1_2", "Tem_A1_2", "Back_A1_2", "Tr_A1_2", "Car 2 is at the wrong bay: flashing light at A1 telling it to go back", db(2)],
      ],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "A1top1",
      start: "A1",
      finish: "p1",
      control: "ctrl_p1_1",
      stepComment: "Action (iii): a car moves from bay A1 back to the first junction",
      controlComment: "Cars detected at the first junction after coming back from A1, not yet given directions",
      rows: [
        [[1], "db_p1_1_1", "Tem_p1_1_1", "Back_p1_1", "Tr_p1_1_1", "Public display at the first junction for car 1 coming back from A1 (label 'Back' in Fig. 4.15)", db(1)],
        [[2], "db_p1_1_2", "Tem_p1_1_2", "Left_p1_2", "Tr_p1_1_2", "Public display at the first junction redirecting car 2 after its wrong turn to A1 (label 'Left' in Fig. 4.15)", db(2)],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "p1top2",
      start: "p1",
      finish: "p2",
      control: "ctrl_p2",
      at: GARAGE_AT.p2,
      stepComment: "Action (iv): a car moves from the first junction to the second junction",
      finishComment: "Sensor of the second junction",
      controlComment: "Cars detected by the second junction's sensor that have not yet been given directions there",
      rows: [
        [[1], "db_p2_1", "Tem_p2_1", "Back_p2_1", "Tr_p2_1", "Public display at the second junction: car 1 missed bay A1 and is told to go back", db(1)],
        [[2], "db_p2_2", "Tem_p2_2", "Right_p2_2", "Tr_p2_2", "Public display at the second junction: arrow to the right (towards bay A2) for car 2", db(2)],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "p2toA2",
      start: "p2",
      finish: "A2",
      control: "ctrl_A2",
      at: GARAGE_AT.A2,
      stepComment: "Action (v): a car moves from the second junction to parking bay A2",
      finishComment: "Sensor of parking bay A2 (scans the ID of the car parked there)",
      controlComment: "Cars detected at bay A2 that have not yet had the system's response",
      rows: [
        [[1], "db_A2_1", "Tem_A2_1", "Back_A2_1", "Tr_A2_1", "Car 1 is at the wrong bay: flashing light at A2 telling it to go back", db(1)],
        [[2], "db_A2_2", "Tem_A2_2", "Park_A2_2", "Tr_A2_2", "Car 2 is at its own bay: parking confirmed, the remaining time is sent to the driver's mobile device", db(2)],
      ],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "A2top2",
      start: "A2",
      finish: "p2",
      control: "ctrl_p2_1",
      stepComment: "Action (vi): a car moves from bay A2 back to the second junction",
      controlComment: "Cars detected at the second junction after coming back from A2, not yet given directions",
      rows: [
        [[1], "db_p2_1_1", "Tem_p2_1_1", "Left_p2_1", "Tr_p2_1_1", "Public display at the second junction redirecting car 1 after its wrong turn to A2 (label 'Left' in Fig. 4.15)", db(1)],
        [[2], "db_p2_1_2", "Tem_p2_1_2", "Back_p2_2", "Tr_p2_1_2", "Public display at the second junction for car 2 coming back from A2 (label 'Back' in Fig. 4.15)", db(2)],
      ],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "p2top1",
      start: "p2",
      finish: "p1",
      control: "ctrl_p1_2",
      stepComment: "Action (vii): a car moves from the second junction back to the first junction",
      controlComment: "Cars detected at the first junction after coming back from the second junction, not yet given directions",
      rows: [
        [[1], "db_p1_2_1", "Tem_p1_2_1", "Right_p1_1", "Tr_p1_2_1", "Public display at the first junction: car 1 coming back is shown the way to bay A1 (label 'Right' in Fig. 4.15)", db(1)],
        [[2], "db_p1_2_2", "Tem_p1_2_2", "Back_p1_2", "Tr_p1_2_2", "Public display at the first junction: car 2 is told to go back to the second junction", db(2)],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "Moving_to_exit",
      start: "p2",
      finish: "exit",
      control: "ctrl_exit",
      at: GARAGE_AT.exit,
      stepComment: "Action (viii): a car moves from the second junction to the exit",
      finishComment: "Sensor of the exit bar (identifies the car leaving)",
      controlComment: "Cars detected at the exit that the system has not yet let out",
      rows: [[[1, 2], "db_exit_12", "Tem_exit_12", "Bye_exit_12", "Tr_exit_12", "Exit bar lifts and a goodbye message is shown to the leaving car", "Database: cars allowed to leave (no fine to pay)"]],
    },
  },
];

function garageRoot(users: Colour[], blocked: Colour[]): Net {
  return rootNet({
    colourSet: USERS,
    place: "entrance",
    control: "ctrl_entrance",
    users,
    blocked,
    origin: GARAGE_AT.entrance,
    comments: {
      place: "Sensor at the entrance bar: the registered cars that arrive (initial users)",
      control: "Unauthorised cars (ticket not paid): a car whose colour is here is not let in (Sec. 4.5.1)",
    },
    name: "Ambient garage (APN)",
  });
}

export interface CaseOptions {
  /** Users present at the start. Default [1, 2]. */
  users?: Colour[];
  /** Users stopped at the root (unauthorised), Sec. 4.5.1 and 4.5.2. Default none. */
  blocked?: Colour[];
}

function build(root: Net, steps: { kind: "forward" | "backward"; spec: StepSpec }[], name: string, comment: string, at: Record<string, Point>): Net {
  let net = root;
  steps.forEach(({ kind, spec }, i) => {
    // Keep clear the sensor/step places and the step transitions that later compositions add.
    const later = steps.slice(i + 1).flatMap(({ spec: s }) => [at[s.finish], at[s.start] && at[s.finish] ? { x: (at[s.start].x + at[s.finish].x) / 2, y: (at[s.start].y + at[s.finish].y) / 2 } : undefined]);
    const avoid = later.filter((p): p is Point => !!p);
    net = kind === "forward" ? fc(net, spec, avoid) : bc(net, spec, avoid);
  });
  net.name = name;
  net.comment = comment;
  return tidy(net);
}

/**
 * The APN model of the ambient garage (Konios 2015, Fig. 4.15): a root net (entrance, ctrl_entrance)
 * and eight steps, composed by five forward and three backward compositions in the order of the
 * actions (i)-(viii) of Sec. 4.5.1. Bay A1 is allocated to car 1 and bay A2 to car 2.
 */
export function ambientGarage(opts: CaseOptions = {}): Net {
  return build(
    garageRoot(opts.users ?? [1, 2], opts.blocked ?? []),
    GARAGE,
    "Ambient garage (Konios 2015, Fig. 4.15)",
    "APN model of the ambient garage (Konios 2015, Sec. 4.5.1, Fig. 4.15). Step places are the sensors of the garage areas, response places the advice on the public displays, database places the allocation of bays to cars 1 and 2.",
    GARAGE_AT,
  );
}

/** Fig. 4.14: the fragment of the garage model with the steps entrance → p1 → A1 → p1 (two forward and one backward composition). */
export function ambientGarageFragment(opts: CaseOptions = {}): Net {
  return build(
    garageRoot(opts.users ?? [1, 2], opts.blocked ?? []),
    GARAGE.slice(0, 3),
    "Ambient garage fragment (Konios 2015, Fig. 4.14)",
    "Fragment of the APN model of the ambient garage (Konios 2015, Fig. 4.14): root net, forward compositions on entrance and p1, backward composition merging A1 and p1.",
    GARAGE_AT,
  );
}

// ---------------------------------------------------------------------------------------------
// Ambient Conference Room

const CONF_AT: Record<string, Point> = {
  participants: { x: 600, y: 2500 },
  entering_room: { x: 600, y: 2150 },
  home_page: { x: 600, y: 1750 },
  intruder_in_PC_area: { x: 1150, y: 1750 },
  papers_scored: { x: 600, y: 1300 },
  given_role: { x: 600, y: 900 },
  awaiting_decision: { x: 1150, y: 900 },
  committee_session: { x: 600, y: 450 },
  waiting_return: { x: 600, y: 60 },
  final_decision: { x: 1150, y: 450 },
  participants_see_decision_on_public_display: { x: 1700, y: 700 },
};

const CONFERENCE: { kind: "forward" | "backward"; spec: StepSpec }[] = [
  {
    kind: "forward",
    spec: {
      step: "swipe_card",
      start: "participants",
      finish: "entering_room",
      control: "ctrl_en_room",
      at: CONF_AT.entering_room,
      stepComment: "Action (i): a participant swipes the smart card at the door and enters the room for the first phase",
      finishComment: "General condition: the participant is in the room",
      controlComment: "Card swipes read by the door's card reader that the system has not yet answered",
      rows: [[[1, 2], "users", "Tem_en_room", "access_granted", "Tr_en_room", "Door opens: access granted to the room", "Database of registered members allowed in the first phase"]],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "sit_and_enter_credentials",
      start: "entering_room",
      finish: "home_page",
      control: "ctrl_home_page",
      at: CONF_AT.home_page,
      stepComment: "Action (ii): a temporary reviewer sits at a private display (PC) and enters the credentials at the start of the break",
      finishComment: "Task: the reviewer is logged in and sees the home page with the papers to score",
      controlComment: "Log-ins detected by the role-based access control that have not yet been answered",
      rows: [
        [[1], "f_user_credentials", "Tem_home_page_1", "f_log_in_done", "Tr_home_page_1", "Private display of user 1: log-in done, home page shown", "Credentials (username, password, role) of user 1"],
        [[2], "s_user_credentials", "Tem_home_page_2", "s_log_in_done", "Tr_home_page_2", "Private display of user 2: log-in done, home page shown", "Credentials (username, password, role) of user 2"],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "intruder_enters_PC_area",
      start: "home_page",
      finish: "intruder_in_PC_area",
      control: "ctrl_intr_PC_area",
      at: CONF_AT.intruder_in_PC_area,
      stepComment: "Action (iii): an unauthorised user enters the room or the area of a private display during the break",
      finishComment: "Detection: the sensor of a private display senses an unauthorised person in range",
      controlComment: "Intrusions sensed at the private displays that the system has not yet reacted to",
      rows: [
        [[1], "PC_area_1", "Tem_PC_area_1", "PC1_off", "Tr_PC_area_1", "Private display 1 hides its information", "Private display area of user 1"],
        [[2], "PC_area_2", "Tem_PC_area_2", "PC2_off", "Tr_PC_area_2", "Private display 2 hides its information", "Private display area of user 2"],
      ],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "intruder_leaves_PC_area",
      start: "intruder_in_PC_area",
      finish: "home_page",
      control: "ctrl_home_page_1",
      stepComment: "Action (iv): the unauthorised user leaves, and the break phase goes on as before the interruption",
      controlComment: "Departures of the intruder sensed by the private displays, not yet answered",
      rows: [[[1, 2], "PC_area", "Tem_home_page1", "respective_PC_on", "Tr_home_page1", "The private display shows its information again", "Private display areas of users 1 and 2"]],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "score_papers",
      start: "home_page",
      finish: "papers_scored",
      control: "ctrl_papers_scored",
      at: CONF_AT.papers_scored,
      stepComment: "Action (v): the temporary reviewer goes on with the break phase and scores the papers",
      finishComment: "Task: the papers are scored",
      controlComment: "Scorings submitted that the system has not yet acknowledged",
      rows: [
        [[2], "timer_expired", "Tem_papers_scored_1", "no_scored_papers", "Tr_papers_scored_1", "Private display: the break is over and the papers were not scored in time", "Reviewers whose time for scoring has run out"],
        [[1, 2], "on_time", "Tem_papers_scored_2", "score_on_time", "Tr_papers_scored_2", "Private display: scores received on time", "Reviewers still within the time for scoring"],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "log_out",
      start: "papers_scored",
      finish: "given_role",
      control: "ctrl_given_role",
      at: CONF_AT.given_role,
      stepComment: "Action (vi): the temporary reviewers log out at the end of the break phase",
      finishComment: "General condition: the user now acts in the role assigned for the second phase",
      controlComment: "Log-outs detected that the system has not yet answered with the user's next role",
      rows: [
        [[1], "double_role", "Tem_given_role_1", "auth_spokesperson", "Tr_given_role_1", "Display: authorised as spokesperson for the second phase", "Users with a second role (spokesperson)"],
        [[2], "only_reviewer", "Tem_given_role_2", "leave_room", "Tr_given_role_2", "Display: the temporary reviewer must leave the room", "Users who are only temporary reviewers"],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "reviewer_leaves",
      start: "given_role",
      finish: "awaiting_decision",
      control: "ctrl_awaiting",
      at: CONF_AT.awaiting_decision,
      stepComment: "Action (vii): the user not authorised for the second phase leaves the room and waits for the final decision",
      finishComment: "General condition: outside the room, waiting for the final decision",
      controlComment: "Exits through the door's card reader not yet answered",
      rows: [[[2], "unauth_reviewer", "Tem_awaiting", "no_access", "Tr_awaiting", "Door: no access to the second phase", "Users not authorised for the second phase"]],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "in_committed",
      start: "given_role",
      finish: "committee_session",
      control: "ctrl_com_session",
      at: CONF_AT.committee_session,
      stepComment: "Action (viii): the authorised spokesperson takes part in the second phase (committee session)",
      finishComment: "Task: the committee session of the second phase",
      controlComment: "Spokespersons who joined the session and have not yet been shown their papers",
      rows: [
        [[1], "fir_paper", "Tem_com_session_1", "in_conflict", "Tr_com_session_1", "Display: the member is in conflict with the paper under discussion", "First paper: members in conflict with it"],
        [[1], "sec_paper", "Tem_com_session_2", "no_conflict", "Tr_com_session_2", "Display: no conflict with the paper under discussion", "Second paper: members without conflict"],
      ],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "to_be_replaced",
      start: "committee_session",
      finish: "waiting_return",
      control: "ctrl_return",
      at: CONF_AT.waiting_return,
      stepComment: "Action (ix): a committee member in conflict with a paper is replaced and exits the room",
      finishComment: "General condition: the replaced member waits outside",
      controlComment: "Replacements detected and not yet answered",
      rows: [[[1], "replaced_reviewer", "Tem_return", "wait_committee", "Tr_return", "Display: wait for the committee's decision on the paper", "Members replaced for a paper"]],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "make_decision",
      start: "committee_session",
      finish: "final_decision",
      control: "ctrl_final_decision",
      at: CONF_AT.final_decision,
      stepComment: "Action (xi): the committee makes the final decision at the end of the second phase",
      finishComment: "Task: the final decision is made",
      controlComment: "Decisions entered and not yet confirmed",
      rows: [[[1], "member", "Tem_fin_decision", "decision_confirmed", "Tr_fin_decision", "Chair's display: decision confirmed", "Committee members"]],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "return_after_decision",
      start: "waiting_return",
      finish: "final_decision",
      control: "ctrl_final_decision_1",
      stepComment: "Action (x): the replaced member returns to the session once the decision about that paper is made",
      controlComment: "Returning members detected and not yet confirmed",
      rows: [[[1], "member_1", "Tem_fin_decision1", "decision_confirmed_1", "Tr_fin_decision1", "Display: decision confirmed to the returning member", "Committee members"]],
    },
  },
  {
    kind: "forward",
    spec: {
      step: "announcing_decision",
      start: "awaiting_decision",
      finish: "participants_see_decision_on_public_display",
      control: "ctrl_see_display",
      at: CONF_AT.participants_see_decision_on_public_display,
      stepComment: "Action (xii): the final decision is announced to the participants waiting outside",
      finishComment: "The participants see the decision on the public display",
      controlComment: "Participants detected in front of the public display who have not yet been shown the decision",
      // The row of the drawn control system that serves users arriving from awaiting_decision (Fig. 7.49).
      rows: [[[2], "unauth_user_final", "Tem_see_display_1", "unauth_wait_and_see_decision", "Tr_see_display_1", "Public display: the decision, for a user who waited outside", "Users who were not authorised in the second phase"]],
    },
  },
  {
    kind: "backward",
    spec: {
      step: "announcing_decision_1",
      start: "final_decision",
      finish: "participants_see_decision_on_public_display",
      control: "ctrl_see_display_1",
      stepComment: "Action (xii): the final decision is announced to the committee (Fig. 4.17 draws this step twice, as announcing_decision_1 and _2)",
      controlComment: "Committee members detected in front of the public display who have not yet been shown the decision",
      // The row of the drawn control system that serves users arriving from final_decision (Figs 7.47, 7.48).
      rows: [[[1], "auth_user_final", "Tem_see_display_2", "auth_exit_and_see_decision", "Tr_see_display_2", "Public display: the decision, for an authorised user leaving", "Users authorised in the second phase"]],
    },
  },
];

function conferenceRoot(users: Colour[], blocked: Colour[]): Net {
  return rootNet({
    colourSet: USERS,
    place: "participants",
    control: "ctrl_participants",
    users,
    blocked,
    origin: CONF_AT.participants,
    comments: {
      place: "Detection: the card reader on the door (the registered participants, initial users)",
      control: "Unauthorised users: a user whose colour is here may not take part from the beginning (Sec. 4.5.2)",
    },
    name: "Ambient conference room (APN)",
  });
}

/**
 * The APN model of the ambient conference room (Konios 2015, Fig. 4.17): a root net (participants,
 * ctrl_participants) and thirteen steps for the actions (i)-(xii) of Sec. 4.5.2, ten composed forward
 * and three backward (see the readings at the top of this file).
 */
export function ambientConferenceRoom(opts: CaseOptions = {}): Net {
  return build(
    conferenceRoot(opts.users ?? [1, 2], opts.blocked ?? []),
    CONFERENCE,
    "Ambient conference room (Konios 2015, Fig. 4.17)",
    "APN model of the ambient conference room (Konios 2015, Sec. 4.5.2, Fig. 4.17). Step places are tasks, detections of users and general conditions; response places the advice on the public and private displays; database places credentials and roles of users 1 and 2.",
    CONF_AT,
  );
}

/** Fig. 4.16: the fragment of the conference room model with the steps participants → entering_room → home_page. */
export function ambientConferenceRoomFragment(opts: CaseOptions = {}): Net {
  return build(
    conferenceRoot(opts.users ?? [1, 2], opts.blocked ?? []),
    CONFERENCE.slice(0, 2),
    "Ambient conference room fragment (Konios 2015, Fig. 4.16)",
    "Fragment of the APN model of the ambient conference room (Konios 2015, Fig. 4.16): root net and two forward compositions, on participants and on entering_room.",
    CONF_AT,
  );
}

/** The step transitions of the garage and the conference room in composition order, with their kind (for tests and documentation). */
export const CASE_COMPOSITIONS = {
  garage: GARAGE.map((s) => ({ kind: s.kind, step: s.spec.step, from: s.spec.start, to: s.spec.finish })),
  conferenceRoom: CONFERENCE.map((s) => ({ kind: s.kind, step: s.spec.step, from: s.spec.start, to: s.spec.finish })),
};

// ---------------------------------------------------------------------------------------------
// T-APN versions (Sec. 6.5): the construction φ of Def. 21 applied to the APN models.

/** φ of the ambient garage model: its T-APN, without inhibitor arcs (Konios 2015, Sec. 6.5). */
export function ambientGarageTapn(opts: CaseOptions = {}): Net {
  return constructTapn(ambientGarage(opts), { name: "Ambient garage (T-APN)" }).net;
}

/** φ of the garage fragment of Fig. 4.14 (Konios 2015, Fig. 6.7). */
export function ambientGarageFragmentTapn(opts: CaseOptions = {}): Net {
  return constructTapn(ambientGarageFragment(opts), { name: "Ambient garage fragment (T-APN, Fig. 6.7)" }).net;
}

/** φ of the ambient conference room model: its T-APN (Konios 2015, Sec. 6.5). */
export function ambientConferenceRoomTapn(opts: CaseOptions = {}): Net {
  return constructTapn(ambientConferenceRoom(opts), { name: "Ambient conference room (T-APN)" }).net;
}

/** φ of the conference room fragment of Fig. 4.16 (Konios 2015, Fig. 6.9). */
export function ambientConferenceRoomFragmentTapn(opts: CaseOptions = {}): Net {
  return constructTapn(ambientConferenceRoomFragment(opts), { name: "Ambient conference room fragment (T-APN, Fig. 6.9)" }).net;
}
