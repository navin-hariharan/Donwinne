// The CTL formulas of Konios (2015), chapter 7, as printed in the figures, with the verdict the
// thesis reports for each. Transcribed literally (spacing aside); long conjunctions over lists of
// (advice, database) pairs are generated from the lists in the order the figures give them.

export type CaseNet = "garage" | "conference";

export interface ThesisFormula {
  /** Figure number and net, e.g. "7.1/garage". */
  id: string;
  figure: string;
  section: string;
  property: string;
  net: CaseNet;
  text: string;
  /** The result the thesis reports. */
  expected: boolean;
  /** Set when the figure itself cannot be transcribed completely. */
  untranscribable?: string;
}

const conj = (xs: string[]) => xs.join(" & ");

const GARAGE_DISPLAYS = ["Left_p1_1", "Forward_p1_2", "Left_p1_2", "Back_p1_1", "Park_A1_1", "Back_A1_2", "Right_p2_2", "Back_p2_1", "Back_A2_1", "Park_A2_2", "Left_p2_1", "Back_p2_2", "Bye_exit_12"];
const CONF_DISPLAYS = ["access_granted", "f_log_in_done", "s_log_in_done", "PC1_off", "PC2_off", "respective_PC_on", "score_on_time", "no_scored_papers", "in_conflict", "no_conflict", "participants_see_decision_on_public_display"];
const displays = (xs: string[]) => `AG(${conj(xs.map((x) => `(EF(${x} == 0) | EF(${x} != 0))`))});`;

const GARAGE_LEAK: [string, string, number][] = [
  ["db_p1_1", "Left_p1_1", 1],
  ["db_p1_2", "Forward_p1_2", 1],
  ["db_p1_1_2", "Left_p1_2", 1],
  ["db_p1_1_1", "Back_p1_1", 1],
  ["db_A1_1", "Park_A1_1", 1],
  ["db_A1_2", "Back_A1_2", 1],
  ["db_p1_2_2", "Back_p1_2", 1],
  ["db_p1_2_1", "Right_p1_1", 1],
  ["db_p2_2", "Right_p2_2", 1],
  ["db_p2_1", "Back_p2_1", 1],
  ["db_A2_2", "Park_A2_2", 1],
  ["db_A2_1", "Back_A2_1", 1],
  ["db_p2_1_1", "Left_p2_1", 1],
  ["db_p2_1_1", "Back_p2_2", 1],
  ["db_exit_12", "Bye_exit_12", 2],
];

const GARAGE_RELATE: [string, string][] = [
  ["Left_p1_2", "db_p1_1_2==0"],
  ["Back_p1_1", "db_p1_1_1==0"],
  ["Forward_p1_2", "db_p1_2==0"],
  ["Left_p1_1", "db_p1_1==0"],
  ["Park_A1_1", "db_A1_1==0"],
  ["Back_A1_2", "db_A1_2==0"],
  ["Back_p1_2", "db_p1_2_2==0"],
  ["Right_p1_1", "db_p1_2_1==0"],
  ["Right_p2_2", "db_p2_2==0"],
  ["Back_p2_1", "db_p2_1==0"],
  ["Back_A2_1", "db_A2_1==0"],
  ["Park_A2_2", "db_A2_2==0"],
  ["Back_p2_2", "db_p2_1_2==0"],
  ["Left_p2_1", "db_p2_1_1==0"],
  ["Bye_exit_12", "db_exit_12<2"],
];
const CONF_RELATE: [string, string][] = [
  ["access_granted", "users<2"],
  ["f_log_in_done", "f_user_credentials==0"],
  ["s_log_in_done", "s_user_credentials==0"],
  ["PC1_off", "PC_area_1==0"],
  ["PC2_off", "PC_area_2==0"],
  ["respective_PC_on", "PC_area<2"],
  ["auth_spokesperson", "double_role==0"],
  ["leave_room", "only_reviewer==0"],
  ["no_access", "unauth_reviewer==0"],
  ["in_conflict", "fir_paper==0"],
  ["no_conflict", "sec_paper==0"],
  ["wait_committee", "replaced_reviewer==0"],
  ["decision_confirmed", "member==0"],
  ["decision_confirmed_1", "member_1==0"],
];
const relate = (pairs: [string, string][]) => conj(pairs.map(([a, d]) => `AG(${a} ->A(${a}!=0 U ${d}))`)) + ";";

const GARAGE_REFILL: [string, string][] = [
  ["Left_p1_1", "db_p1_1"],
  ["Forward_p1_2", "db_p1_2"],
  ["Back_p1_1", "db_p1_1_1"],
  ["Left_p1_2", "db_p1_1_2"],
  ["Park_A1_1", "db_A1_1"],
  ["Back_A1_2", "db_A1_2"],
  ["Back_p2_1", "db_p2_1"],
  ["Right_p2_2", "db_p2_2"],
  ["Right_p1_1", "db_p1_2_1"],
  ["Back_p1_2", "db_p1_2_2"],
  ["Left_p2_1", "db_p2_1_1"],
  ["Back_p2_2", "db_p2_1_2"],
  ["Back_A2_1", "db_A2_1"],
  ["Park_A2_2", "db_A2_2"],
  ["Bye_exit_12", "db_exit_12"],
];
const CONF_REFILL: [string, string][] = [
  ["access_granted", "users"],
  ["f_log_in_done", "f_user_credentials"],
  ["s_log_in_done", "s_user_credentials"],
  ["no_scored_papers", "timer_expired"],
  ["score_on_time", "on_time"],
  ["respective_PC_on", "PC_area"],
  ["PC1_off", "PC_area_1"],
  ["PC2_off", "PC_area_2"],
  ["auth_spokesperson", "double_role"],
  ["leave_room", "only_reviewer"],
  ["no_access", "unauth_reviewer"],
  ["in_conflict", "fir_paper"],
  ["no_conflict", "sec_paper"],
  ["decision_confirmed", "member"],
  ["decision_confirmed_1", "member_1"],
  ["wait_committee", "replaced_reviewer"],
  ["unauth_wait_and_see_decision", "unauth_user_final"],
  ["auth_exit_and_see_decision", "auth_user_final"],
];

type Row = [figure: string, section: string, property: string, net: CaseNet, expected: boolean, text: string, untranscribable?: string];

const ROWS: Row[] = [
  ["7.1", "7.1.1.1.1", "Examining sensors: detection", "garage", true,
    "AG(entrance==2 -> AX(p1>0&ctrl_p1>0) & (p1==2 -> AX((p2>0&ctrl_p2>0) | (A1>0 & ctrl_A1>0))) & (A1==2 -> AX(p1>0&ctrl_p1_1>0)) & (p2==2 -> AX((A2>0&ctrl_A2>0) | (p1>0 & ctrl_p1_2>0) | (exit>0 & ctrl_exit>0 ))) & (A2==2 -> AX(p2>0&ctrl_p2_1>0)));"],
  ["7.1", "7.1.1.1.1", "Examining sensors: detection", "conference", true,
    "AG(participants==2 -> AX(entering_room>0&ctrl_en_room>0) & (entering_room==2 -> AX(home_page>0&ctrl_home_page>0)) & (intruder_in_PC_area==2 -> AX(home_page>0&ctrl_home_page_1>0)) & (home_page==2 -> EX(intruder_in_PC_area>0&ctrl_intr_PC_area>0))& (committee_session==2 -> EX(waiting_return>0&ctrl_return>0)));"],
  ["7.3", "7.1.1.1.1", "Examining sensors: no overlap", "garage", true, "AG((p1==2 & ctrl_p1==2) -> ! (p2==2 & ctrl_p2==2));"],
  ["7.3", "7.1.1.1.1", "Examining sensors: no overlap", "conference", true, "AG((home_page==2 & ctrl_home_page==2) -> !(intruder_in_PC_area==2 & ctrl_intr_PC_area==2));"],
  ["7.5", "7.1.1.1.2", "User's initiative: ignoring an advice", "garage", true,
    "AG((p1>0 & Left_p1_1>0 -> EX(p2)) &(p1>0 & Forward_p1_2>0 -> EX(A1)) &(p1>0 & Right_p1_1>0 -> EX(p2)) &(p1>0 & Back_p1_2>0 -> EX(A1)) &(p1>0 & Left_p1_2>0 -> EX(A1)) &(p1>0 & Back_p1_1>0 -> EX(p2)) &(A1>0 & Park_A1_1>0 -> EX(p1)) &(p2>0 & Back_p2_1>0 -> EX(A2)) &(p2>0 & Back_p2_1>0 -> EX(exit)) &(p2>0 & Right_p2_2>0 -> EX(p1)) &(A2>0 & Park_A2_2>0 -> EX(p2)) );"],
  ["7.5", "7.1.1.1.2", "User's initiative: ignoring an advice", "conference", true, "AG((home_page>0 & f_log_in_done>0 -> EX(intruder_in_PC_area)) );"],
  ["7.7", "7.1.1.1.2", "User's initiative: goal after ignoring", "garage", true,
    "AG((p1>0 & Left_p1_1>0 -> EX(p2)) & (p2>0 & Back_p2_1 -> EF(A1)) | (p1>0 & Forward_p1_2>0 -> EX(A1)) & (A1>0 & Back_A1_2 -> EF(A2)));"],
  ["7.7", "7.1.1.1.2", "User's initiative: goal after ignoring", "conference", true,
    "EG((intruder_in_PC_area> 0& (PC1_off==1|PC2_off==1 ) ->AX(home_page)) ->EF(participants_see_decision_on_public_display));"],
  ["7.9", "7.1.1.2.1", "Displays", "garage", true, displays(GARAGE_DISPLAYS)],
  ["7.9", "7.1.1.2.1", "Displays", "conference", true, displays(CONF_DISPLAYS)],
  ["7.11", "7.1.1.2.2", "Leak of information", "garage", true, `AG(${conj(GARAGE_LEAK.map(([d, a, n]) => `(${d} == 0 -> !(${a}>${n}))`))});`],
  ["7.11", "7.1.1.2.2", "Leak of information", "conference", true,
    "AG((intruder_in_PC_area > 1 -> EX(PC1_off | PC2_off)) & (users == 0 -> !(access_granted>2)) & (auth_spokesperson == 1 -> EX(committee_session)) & (only_reviewer == 0 -> (leave_room ==1))& (unauth_reviewer == 0 -> (no_access ==1))& (replaced_reviewer ==0 -> (wait_committee)) );"],
  ["7.13", "7.1.1.3.1", "Notifying the user", "garage", true,
    "AG(((p1&ctrl_p1 -> EX(p1&Left_p1_1)) & (p1&Left_p1_1 -> EX(p2&ctrl_p2)))& ((p1&ctrl_p1 -> EX(p1&Forward_p1_2)) & (p1&Forward_p1_2 -> EX(p2&ctrl_p2)))& ((A1&ctrl_A1 -> EX(A1&Back_A1_2)) & (A1&Back_A1_2 -> EX(p1&ctrl_p1_1)))& ((p1&ctrl_p1_1 -> EX(p1&Back_p1_1)) & (p1&Back_p1_1 -> EX(A1&ctrl_A1)))& ((p1&ctrl_p1_1 -> EX(p1&Left_p1_2)) & (p1&Left_p1_2 -> EX(p2&ctrl_p2)))& ((p2&ctrl_p2 -> EX(p2&Back_p2_1))&(p2&Back_p2_1 -> EX(p1&ctrl_p1_2)))& ((p2&ctrl_p2 -> EX(p2&Right_p2_2))&(p2&Right_p2_2 -> EX(A2&ctrl_A2)))& ((A2&ctrl_A2 -> EX(A2&Back_A2_1))&(A2&Back_A2_1 -> EX(p2&ctrl_p2_1)))& ((p2&ctrl_p2_1 -> EX(p2&Back_p2_1))&(p2&Back_p2_1 -> EX(exit&ctrl_exit))));"],
  ["7.13", "7.1.1.3.1", "Notifying the user", "conference", true, "", "Fig. 7.13b is cut off at the right edge of the page in the thesis itself."],
  ["7.15", "7.1.1.3.2", "Alternation of actions", "garage", true,
    "AG((entrance -> p1) -> AX( (p1==2 & ctrl_p1_1 == 0 & ctrl_p1_2 == 0) -> (Left_p1_1 |Forward_p1_2))) & AG((p1==2 & ctrl_p1_1 == 0 & ctrl_p1_2 == 0) -> (Left_p1_1 ==1 |Forward_p1_2 ==1)) -> AX((p1 == 2 & (Left_p1_1 ==1 |Forward_p1_2 ==1)) -> (p2|A1));"],
  ["7.15", "7.1.1.3.2", "Alternation of actions", "conference", true,
    "AG((participants -> entering_room) -> AX( (entering_room ==2 & home_page == 0) -> (access_granted))) & AG((entering_room ==2 & home_page == 0) -> (access_granted)) -> AX((entering_room == 2 & (access_granted)) -> (home_page));"],
  ["7.17a", "7.1.1.3.3", "Restricting user's actions", "garage", true, "AG((entrance -> p1) -> AX( (p1>0 & ctrl_p1_1==0 & ctrl_p1_2==0) -> (Left_p1_1 |Forward_p1_2)));"],
  ["7.17b", "7.1.1.3.3", "Restricting user's actions", "garage", false, "AG((entrance -> p1) -> AX( p1 -> p2));"],
  ["7.17a", "7.1.1.3.3", "Restricting user's actions", "conference", true, "AG((participants-> entering_room) -> AX( entering_room>1 -> access_granted));"],
  ["7.17b", "7.1.1.3.3", "Restricting user's actions", "conference", false, "AG((participants -> entering_room) -> AX( entering_room -> home_page));"],
  ["7.19", "7.1.1.3.4", "System's actions", "garage", true,
    "AG((entrance -> AX(p1)) -> EX(Left_p1_1 | Forward_p1_2) -> EX(db_p1_1 | db_p1_2) & ((p1 -> AX(A1|p2)) -> (EX(Park_A1_1 | Back_A1_2) | EX(Back_p2_1|Right_p2_2)) -> (EX(db_A1_1 | db_A1_2) | EX(db_p2_1 | db_p2_2))) & ((p2 -> AX(A2|p1|exit)) -> (EX(Park_A2_2 | Back_A2_1) | EX(Back_p1_2|Right_p1_1) | EX(Bye_exit_12)) -> (EX(db_A2_2 | db_A2_1) | EX(db_p1_2_2 | db_p1_2_1) | EX(db_exit_12))) & ((A1 -> AX(p1)) -> EX(Left_p1_2 | Back_p1_1) -> EX(db_p1_1_2 | db_p1_1_1)) & ((A2 -> AX(p2)) -> EX(Left_p2_1 | Back_p2_2) -> EX(db_p2_1_1 | db_p2_1_2)));"],
  ["7.19", "7.1.1.3.4", "System's actions", "conference", true,
    "AG((participants -> AF(entering_room)) -> EF(access_granted) -> EF(users)) & ((entering_room -> AF(home_page)) -> (EF(f_log_in_done | s_log_in_done) -> EF(f_user_credentials|s_user_credentials)) & ((home_page -> AF(intruder_in_PC_area|papers_scored)) -> (EF(PC1_off | PC2_off) | EF(no_scored_papers|score_on_time)) -> (EF(PC_area_1 | PC_area_2) | EF(timer_expired | on_time))) & ((intruder_in_PC_area -> AF(home_page)) -> EF(respective_PC_on) -> EF(PC_area)) & ((papers_scored -> AF(given_role)) -> EF(auth_spokesperson | leave_room) -> EF(double_role | only_reviewer)) & ((given_role -> AF(committee_session|awaiting_decision)) -> (EF(in_conflict | no_conflict) | EF(no_access)) -> (EF(fir_paper | sec_paper) | EF(unauth_reviewer))) & ((committee_session -> AF(final_decision|waiting_return)) -> (EF(decision_confirmed) | EF(wait_committee)) -> (EF(member) | EF(replaced_reviewer))) & ((waiting_return -> AF(final_decision)) -> (EF(decision_confirmed_1)) -> (EF(member_1))) & ((final_decision -> AF(participants_see_decision_on_public_display)) -> (EF(unauth_wait_and_see_decision)|EF(auth_exit_and_see_decision)) -> (EF(unauth_user_final)|EF(auth_user_final))));"],
  ["7.21", "7.1.2.1.1", "Redundancy of advices", "garage", true, "EF(Back_p1_2)&EF(Left_p1_1) & EF(Right_p1_1)&EF(Forward_p1_2)& EF(Park_A1_1)&EF(Park_A2_2) & EF(Bye_exit_12);"],
  ["7.21", "7.1.2.1.1", "Redundancy of advices", "conference", true,
    "EF(f_log_in_done)&EF(s_log_in_done) & EF(no_scored_papers) & EF(score_on_time) & EF(PC1_off)&EF(PC2_off) & EF(in_conflict) & EF(no_conflict) & EF(no_access) & EF(wait_committee);"],
  ["7.23", "7.1.2.1.2", "Returning to previous states", "garage", true, "AG((p1 -> EX(A1))&(A1 ->EX(p1)))& AG((p1 -> EX(p2))&(p2 ->EX(p1)))& AG((p2 -> EX(A2))&(A2 ->EX(p2)));"],
  ["7.23", "7.1.2.1.2", "Returning to previous states", "conference", true, "AG((home_page -> EX(intruder_in_PC_area))&(intruder_in_PC_area ->EX(home_page)));"],
  ["7.25", "7.1.2.2.1", "Relating advice with database resources", "garage", true, relate(GARAGE_RELATE)],
  ["7.25", "7.1.2.2.1", "Relating advice with database resources", "conference", true, relate(CONF_RELATE)],
  ["7.27", "7.1.2.2.2", "Refilling resources", "garage", true, `AG(${conj(GARAGE_REFILL.map(([a, d]) => `(${a} -> EX (${d}))`))});`],
  ["7.27", "7.1.2.2.2", "Refilling resources", "conference", true, `AG(${conj(CONF_REFILL.map(([a, d]) => `(${a} -> (EX (${d})))`))});`],
  ["7.29", "7.1.2.2.3", "Quantity of resources: upper bound", "garage", true, "AG(!(entrance>2)&!(exit>2) & !(p1>2)&!(p2>2) & !(A1>2)&!(A2>2));"],
  ["7.29", "7.1.2.2.3", "Quantity of resources: upper bound", "conference", true,
    "AG(!(participants>2)&!(entering_room>2)&!(papers_scored>2)&!(intruder_in_PC_area>2)&!(given_role>2)&!(awaiting_decision>2)&!(committee_session>2)&!(waiting_return>2)&!(final_decision>2)&!(participants_see_decision_on_public_display>2));"],
  ["7.31", "7.1.2.2.3", "Quantity of resources: lower bound", "garage", true, "AG(!(entrance<0) & !(exit<0) & !(p1<0) & !(p2<0) & !(A1<0)&!(A2<0));"],
  ["7.31", "7.1.2.2.3", "Quantity of resources: lower bound", "conference", true,
    "AG(!(participants<0)&!(entering_room<0)&!(home_page<0)&!(papers_scored<0)&!(intruder_in_PC_area<0)&!(given_role<0)&!(awaiting_decision<0)&!(committee_session<0)&!(waiting_return<0)&!(final_decision<0)&!(participants_see_decision_on_public_display<0));"],
  ["7.33", "7.1.2.2.4", "Reaching user's goal", "garage", true, "EF(A1&Park_A1_1)&EF(A2&Park_A2_2);"],
  ["7.33", "7.1.2.2.4", "Reaching user's goal", "conference", true,
    "EF(final_decision&decision_confirmed)& EF(final_decision&decision_confirmed_1)& EF(participants_see_decision_on_public_display& (unauth_wait_and_see_decision|auth_exit_and_see_decision));"],
  ["7.35", "7.1.2.2.5", "Reaching terminal state", "garage", true,
    "AG(EF(exit==2&db_p1_1 &db_p1_2_2&db_p1_2_1 &db_p2_1&db_p2_2 &db_A2_1&db_A2_2 &db_p2_1_1&db_p2_1_2 &db_A1_2&db_A1_1 &db_p1_1_1&db_p1_1_2 &db_p1_2&db_exit_12==2));"],
  ["7.35", "7.1.2.2.5", "Reaching terminal state", "conference", true,
    "AG(EF(participants_see_decision_on_public_display==2 & users==2 & f_user_credentials & s_user_credentials &timer_expired & on_time == 2 &PC_area == 2 & PC_area_1 & PC_area_2 &double_role & only_reviewer &unauth_reviewer & fir_paper &sec_paper & replaced_reviewer &member & member_1 &unauth_user_final & auth_user_final));"],
  ["7.37", "7.1.2.2.6", "Interacting with users", "garage", true, "AF(EF((A2&Back_A2_1)&(p1&Forward_p1_2)));"],
  ["7.37", "7.1.2.2.6", "Interacting with users", "conference", true, "AF(EF((intruder_in_PC_area&(PC1_off|PC2_off))& (papers_scored&(score_on_time|no_scored_papers))));"],
  ["7.39a", "7.1.2.2.7", "Dealing with improper actions", "garage", false, "AG(A1&Back_A1_2 -> !(EX(p1&ctrl_p1_1)))& AG(A2&Back_A2_1 -> !(EX(p2&ctrl_p2_1)));"],
  ["7.39b", "7.1.2.2.7", "Dealing with improper actions", "garage", false, "AG((p1 -> A1) -> !(EX(A1&Back_A1_2)))& AG((p2 ->A2) -> !(EX(A2&Back_p2_2)));"],
  ["7.39a", "7.1.2.2.7", "Dealing with improper actions", "conference", false, "AG(intruder_in_PC_area ==2&(PC1_off | PC2_off ) -> !(EX(home_page&(PC1_off|PC2_off))));"],
  ["7.39b", "7.1.2.2.7", "Dealing with improper actions", "conference", false, "AG(intruder_in_PC_area ==2 -> !AX(PC1_off | PC2_off ));"],
];

/** Every chapter 7 CTL formula on the fault-free models, with the thesis's verdict. */
export const THESIS_FORMULAS: ThesisFormula[] = ROWS.map(([figure, section, property, net, expected, text, untranscribable]) => ({
  id: `${figure}/${net}`,
  figure,
  section,
  property,
  net,
  text,
  expected,
  ...(untranscribable ? { untranscribable } : {}),
}));

/** §7.3.3: formulas checked on faulty models (extra database tokens; the thesis does not say which). */
export const THESIS_FAULT_FORMULAS: ThesisFormula[] = [
  ["7.55", "Fault tolerance: goal after a wrong advice", "garage", "AG(p2 == 2 & Back_p2_1 == 2 -> EF(exit & Bye_exit_12));"],
  ["7.55", "Fault tolerance: goal after a wrong advice", "conference", "AG(intruder_in_PC_area == 2 & PC1_off == 2 -> EF(participants_see_decision_on_public_display & unauth_wait_and_see_decision & auth_exit_and_see_decision));"],
  ["7.57", "Fault tolerance: correct advice after a wrong one", "garage", "AG(p2 == 2 & Back_p2_1 == 2 -> EF(p2 == 2 & Back_p2_1 == 1 & Right_p2_2));"],
  ["7.57", "Fault tolerance: correct advice after a wrong one", "conference", "AG(intruder_in_PC_area == 2 & PC1_off == 2 -> EF(intruder_in_PC_area == 2 & PC1_off == 1 & PC2_off));"],
].map(([figure, property, net, text]) => ({ id: `${figure}/${net}`, figure, section: "7.3.3", property, net: net as CaseNet, text, expected: true }));

/** §7.2 qualitative results (Tables 7.1-7.2 and the text). FT0..PF0 as the thesis states them. */
export const THESIS_QUALITATIVE = {
  garage: { FT0: true, TF0: true, FP0: false, PF0: false, k: 2, DCF: false, deadStates: 1, deadTransitions: false, live: false, reversible: false, states: 52, edges: 87 },
  conference: { FT0: true, TF0: true, FP0: false, PF0: false, k: 2, DCF: false, deadStates: 1, deadTransitions: false, live: false, reversible: false, states: 82, edges: 130 },
};

/** §7.3.1 (following advices) and §7.3.2 (ignoring them): path queries (Charlie's target filters) and the path lengths the thesis reports. */
export const THESIS_PATHS: { id: string; net: CaseNet; kind: "following" | "ignoring"; target: string; length: number }[] = [
  { id: "7.3.1/garage/a", net: "garage", kind: "following", target: "Left_p1_1 * A1 * Park_A1_1", length: 4 },
  { id: "7.3.1/garage/b", net: "garage", kind: "following", target: "Forward_p1_2 * Right_p2_2 * A2 * Park_A2_2", length: 6 },
  { id: "7.3.1/conference/a (Fig. 7.47)", net: "conference", kind: "following", target: "access_granted * f_log_in_done * score_on_time * auth_spokesperson * no_conflict * decision_confirmed * participants_see_decision_on_public_display * auth_exit_and_see_decision", length: 14 },
  { id: "7.3.1/conference/b (Fig. 7.48)", net: "conference", kind: "following", target: "access_granted * f_log_in_done * score_on_time * auth_spokesperson * in_conflict * wait_committee * decision_confirmed_1 * participants_see_decision_on_public_display * auth_exit_and_see_decision", length: 16 },
  { id: "7.3.1/conference/c (Fig. 7.49)", net: "conference", kind: "following", target: "access_granted * f_log_in_done * score_on_time * leave_room * no_access * participants_see_decision_on_public_display * unauth_wait_and_see_decision", length: 12 },
  { id: "7.3.2/garage/a", net: "garage", kind: "ignoring", target: "entrance * ctrl_entrance * Left_p1_1 * A1 * Park_A1_1 * Back_p2_1 * Right_p1_1", length: 8 },
  { id: "7.3.2/garage/b", net: "garage", kind: "ignoring", target: "entrance * ctrl_entrance * Forward_p1_2 * Right_p2_2 * A2 * Park_A2_2 * Back_A1_2 * Left_p1_2", length: 10 },
  { id: "7.3.2/conference", net: "conference", kind: "ignoring", target: "participants * ctrl_participants * access_granted * f_log_in_done * PC1_off * respective_PC_on * score_on_time * leave_room * no_access * participants_see_decision_on_public_display * unauth_wait_and_see_decision", length: 16 },
];
