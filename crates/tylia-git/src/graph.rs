//! Commit-graph lane layout (ARCHITECTURE.md §5.5).
//!
//! [`GraphBuilder`] takes commits in display order and returns one [`GraphRow`] per commit:
//! the commit's lane (column) and the line segments to draw in its row. A lane is a column
//! waiting for one commit, and no two lanes ever wait for the same commit: when a commit's
//! first parent is already awaited by another lane, the two lines join in this row instead
//! of running side by side down to the parent.
//!
//! - If this commit's lane continues from above and the other lane is to its right, the
//!   other lane bends into this one (a `Through` edge with `from != to`). A line drawn on the
//!   left, typically the mainline, therefore never drifts right.
//! - Otherwise (the other lane is to the left, or this commit is a branch tip) this commit's
//!   line bends into the other lane (a `Bottom` edge with `from != to`).
//!
//! Lanes never move otherwise; free lanes are reused first-fit and trailing ones dropped.
//!
//! So `Top` edges always have `from == to`, and a lane at a row's bottom boundary is reached
//! by one edge carrying it straight down, plus possibly one line joining it; a lane that only
//! starts in this row (a merge's new parent lane) is reached by its single `Bottom` edge.
//!
//! Colours: a lane keeps its colour for its whole life. A lane created for the HEAD commit
//! (HEAD is a branch tip, or a merge above has HEAD as a non-first parent) gets colour 0;
//! every other lane takes the next of 1–7 round-robin, skipping the colours of the lanes
//! directly beside it.

use std::collections::HashMap;

use serde::Serialize;
use ts_rs::TS;

/// Palette index reserved for the lane of the checked-out commit.
const HEAD_COLOR: u8 = 0;
/// Palette indices 1..=OTHER_COLORS are shared by all other lanes.
const OTHER_COLORS: u8 = 7;

/// One row of the commit graph, aligned with one commit in display order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    /// Lane (column, 0-based) of this row's commit dot.
    pub lane: u16,
    /// Palette index 0–7 of the commit's lane (0 = accent, reserved for the checked-out branch).
    pub color: u8,
    pub is_merge: bool,
    /// Lines to draw in this row (see EdgeKind).
    pub edges: Vec<Edge>,
    /// Number of lanes occupied in this row (max lane index used by the dot or any edge, + 1).
    pub width: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edge {
    pub from: u16,
    pub to: u16,
    pub color: u8,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EdgeKind {
    /// From lane `from` at the row's top edge into the commit dot (`to` == row.lane): a child above continues into this commit (merge-in when from != to).
    Top,
    /// From the commit dot (`from` == row.lane) to lane `to` at the row's bottom edge: towards a parent (fork/merge-out when to != from).
    Bottom,
    /// A lane passing through the row without touching the dot: from lane `from` at the top edge to lane `to` at the bottom edge (normally from == to).
    Through,
}

/// Incremental layout: feed commits in display order (as `git log` emits them), get one row per commit.
pub struct GraphBuilder {
    head: Option<String>,
    /// Colour of each lane, `None` while the lane is free.
    lanes: Vec<Option<u8>>,
    /// The lane waiting for each pending commit (at most one per commit).
    waiting: HashMap<String, u16>,
    /// Next colour in the 1..=OTHER_COLORS rotation.
    next_color: u8,
}

impl GraphBuilder {
    /// `head`: the commit HEAD points at, if any (its lane gets colour 0, see the module docs).
    pub fn new(head: Option<&str>) -> Self {
        Self {
            head: head.map(str::to_owned),
            lanes: Vec::new(),
            waiting: HashMap::new(),
            next_color: 1,
        }
    }

    /// `oid` and `parents` are hex object ids (40 or 64 chars). Parents in git order (first parent first).
    pub fn push(&mut self, oid: &str, parents: &[String]) -> GraphRow {
        let waiter = self.waiting.remove(oid);
        let mut edges: Vec<Edge> = (0u16..)
            .zip(&self.lanes)
            .filter_map(|(lane, color)| {
                let color = (*color)?;
                (Some(lane) != waiter).then_some(Edge {
                    from: lane,
                    to: lane,
                    color,
                    kind: EdgeKind::Through,
                })
            })
            .collect();
        let lane = match waiter {
            Some(lane) => {
                edges.push(Edge {
                    from: lane,
                    to: lane,
                    color: self.color(lane),
                    kind: EdgeKind::Top,
                });
                lane
            }
            None => self.alloc(oid),
        };
        let color = self.color(lane);

        // A lane that bent into ours; freed only after the row so that no new parent lane
        // is allocated where a line is still leaving.
        let mut joined = None;
        match parents.first() {
            None => self.lanes[usize::from(lane)] = None,
            Some(parent) => {
                let to = match self.waiting.get_mut(parent.as_str()) {
                    Some(other) if waiter.is_some() && *other > lane => {
                        let through = edges
                            .iter_mut()
                            .find(|e| e.from == *other)
                            .expect("a waiting lane passes through");
                        through.to = lane;
                        joined = Some(*other);
                        *other = lane;
                        lane
                    }
                    Some(other) => {
                        self.lanes[usize::from(lane)] = None;
                        *other
                    }
                    None => {
                        self.waiting.insert(parent.clone(), lane);
                        lane
                    }
                };
                edges.push(Edge {
                    from: lane,
                    to,
                    color,
                    kind: EdgeKind::Bottom,
                });
            }
        }
        for (i, parent) in parents.iter().enumerate().skip(1) {
            if parents[..i].contains(parent) {
                continue;
            }
            let to = match self.waiting.get(parent.as_str()) {
                Some(&to) => to,
                None => {
                    let to = self.alloc(parent);
                    self.waiting.insert(parent.clone(), to);
                    to
                }
            };
            edges.push(Edge {
                from: lane,
                to,
                color: self.color(to),
                kind: EdgeKind::Bottom,
            });
        }
        if let Some(other) = joined {
            self.lanes[usize::from(other)] = None;
        }
        while self.lanes.last() == Some(&None) {
            self.lanes.pop();
        }

        let width = edges.iter().map(|e| e.from.max(e.to)).fold(lane, u16::max) + 1;
        GraphRow {
            lane,
            color,
            is_merge: parents.len() > 1,
            edges,
            width,
        }
    }

    fn color(&self, lane: u16) -> u8 {
        self.lanes[usize::from(lane)].expect("lane is occupied")
    }

    /// Occupies the first free lane for a line leading to `oid` and picks its colour.
    fn alloc(&mut self, oid: &str) -> u16 {
        let lane = self
            .lanes
            .iter()
            .position(Option::is_none)
            .unwrap_or(self.lanes.len());
        let color = if self.head.as_deref() == Some(oid) {
            HEAD_COLOR
        } else {
            let neighbour = |i: Option<usize>| i.and_then(|i| self.lanes.get(i).copied().flatten());
            let (left, right) = (neighbour(lane.checked_sub(1)), neighbour(Some(lane + 1)));
            let color = (0..OTHER_COLORS)
                .map(|k| (self.next_color - 1 + k) % OTHER_COLORS + 1)
                .find(|&c| Some(c) != left && Some(c) != right)
                .expect("two neighbours cannot use up all colours");
            self.next_color = color % OTHER_COLORS + 1;
            color
        };
        if lane == self.lanes.len() {
            self.lanes.push(Some(color));
        } else {
            self.lanes[lane] = Some(color);
        }
        lane as u16
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BinaryHeap, HashSet};
    use std::time::Instant;

    type History = Vec<(String, Vec<String>)>;

    /// Parses one commit per line: `oid parent...`, in display order.
    fn history(spec: &str) -> History {
        spec.lines()
            .filter_map(|line| {
                let mut words = line.split_whitespace();
                let oid = words.next()?;
                Some((oid.to_owned(), words.map(str::to_owned).collect()))
            })
            .collect()
    }

    /// Lays out `history`, checking the builder's invariants and the rendering contract.
    fn layout(history: &History, head: Option<&str>) -> Vec<GraphRow> {
        let mut builder = GraphBuilder::new(head);
        let rows: Vec<GraphRow> = history
            .iter()
            .map(|(oid, parents)| {
                let row = builder.push(oid, parents);
                check_state(&builder);
                row
            })
            .collect();
        check_contract(history, &rows);
        check_lines(history, &rows);
        rows
    }

    /// Every occupied lane waits for exactly one commit and vice versa; no trailing free lane.
    fn check_state(builder: &GraphBuilder) {
        let occupied = builder.lanes.iter().filter(|l| l.is_some()).count();
        let lanes: HashSet<u16> = builder.waiting.values().copied().collect();
        assert_eq!(
            lanes.len(),
            builder.waiting.len(),
            "two lanes wait for one commit"
        );
        assert_eq!(lanes.len(), occupied);
        assert!(
            lanes
                .iter()
                .all(|&l| builder.lanes[usize::from(l)].is_some())
        );
        assert_ne!(builder.lanes.last(), Some(&None));
    }

    /// Per row: lanes active at the top are each continued by exactly one `Top`/`Through`
    /// edge in their colour; lanes active at the bottom are carried by exactly one straight
    /// edge (or by a single edge if they start here); `width` is exact; colours never change
    /// within a lane's life.
    fn check_contract(history: &History, rows: &[GraphRow]) {
        let mut active: Vec<Option<u8>> = Vec::new();
        let mut referenced = HashSet::new();
        for ((oid, parents), row) in history.iter().zip(rows) {
            let max = row
                .edges
                .iter()
                .map(|e| e.from.max(e.to))
                .fold(row.lane, u16::max);
            assert_eq!(row.width, max + 1, "{oid}: width");

            for e in row.edges.iter().filter(|e| e.kind != EdgeKind::Bottom) {
                let color = active.get(usize::from(e.from)).copied().flatten();
                assert_eq!(
                    color,
                    Some(e.color),
                    "{oid}: {e:?} starts off an active lane"
                );
            }
            for (lane, _) in active.iter().enumerate().filter(|(_, c)| c.is_some()) {
                let starts = row
                    .edges
                    .iter()
                    .filter(|e| e.kind != EdgeKind::Bottom && usize::from(e.from) == lane)
                    .count();
                assert_eq!(starts, 1, "{oid}: lane {lane} at the top");
            }

            let tops: Vec<&Edge> = row
                .edges
                .iter()
                .filter(|e| e.kind == EdgeKind::Top)
                .collect();
            assert_eq!(
                tops.len(),
                usize::from(referenced.contains(oid)),
                "{oid}: top"
            );
            for e in &tops {
                assert_eq!((e.from, e.to, e.color), (row.lane, row.lane, row.color));
            }
            let bottoms: Vec<&Edge> = row
                .edges
                .iter()
                .filter(|e| e.kind == EdgeKind::Bottom)
                .collect();
            assert_eq!(
                bottoms.len(),
                distinct(parents).len(),
                "{oid}: one edge per parent"
            );
            assert!(bottoms.iter().all(|e| e.from == row.lane));
            if let Some(first) = bottoms.first() {
                assert_eq!(
                    first.color, row.color,
                    "{oid}: first parent keeps the colour"
                );
            }
            assert_eq!(row.is_merge, parents.len() > 1);

            let mut next = vec![None; usize::from(row.width)];
            for (lane, slot) in next.iter_mut().enumerate() {
                let ending: Vec<&Edge> = row
                    .edges
                    .iter()
                    .filter(|e| e.kind != EdgeKind::Top && usize::from(e.to) == lane)
                    .collect();
                let straight: Vec<&Edge> =
                    ending.iter().copied().filter(|e| e.from == e.to).collect();
                *slot = match (straight.as_slice(), ending.as_slice()) {
                    (_, []) => None,
                    ([carrier], _) | ([], [carrier]) => Some(carrier.color),
                    _ => panic!("{oid}: lane {lane} at the bottom is ambiguous: {ending:?}"),
                };
            }
            while next.last() == Some(&None) {
                next.pop();
            }
            active = next;
            referenced.extend(parents.iter().cloned());
        }
    }

    /// Follows every parent line down the rows: it must end in that parent's dot, or run off
    /// the bottom if the parent is not in the input.
    fn check_lines(history: &History, rows: &[GraphRow]) {
        let position: HashMap<&str, usize> = (0..)
            .zip(history)
            .map(|(i, (oid, _))| (oid.as_str(), i))
            .collect();
        for (i, ((oid, parents), row)) in history.iter().zip(rows).enumerate() {
            let bottoms = row.edges.iter().filter(|e| e.kind == EdgeKind::Bottom);
            for (parent, edge) in distinct(parents).into_iter().zip(bottoms) {
                let mut lane = edge.to;
                let reached = rows.iter().enumerate().skip(i + 1).find_map(|(j, row)| {
                    let e = row
                        .edges
                        .iter()
                        .find(|e| e.kind != EdgeKind::Bottom && e.from == lane)
                        .unwrap_or_else(|| panic!("{oid} -> {parent}: line broken at row {j}"));
                    lane = e.to;
                    (e.kind == EdgeKind::Top).then_some(j)
                });
                assert_eq!(
                    reached,
                    position.get(parent.as_str()).copied(),
                    "{oid} -> {parent}"
                );
            }
        }
    }

    fn distinct(parents: &[String]) -> Vec<&String> {
        let mut seen = Vec::new();
        for p in parents {
            if !seen.contains(&p) {
                seen.push(p);
            }
        }
        seen
    }

    /// One line per commit: `*` commit, `M` merge, `o` root, `|` lane passing through; then,
    /// if any line changes lane in that row, a connector line drawn with `\`, `/` and `-`.
    fn render(history: &History, head: Option<&str>, names: bool) -> String {
        let rows = layout(history, head);
        let pad = rows
            .iter()
            .map(|r| usize::from(r.width) * 2)
            .max()
            .unwrap_or(0);
        let mut out = String::new();
        for ((oid, parents), row) in history.iter().zip(&rows) {
            let mut line = vec![' '; pad];
            for e in row.edges.iter().filter(|e| e.kind == EdgeKind::Through) {
                line[usize::from(e.from) * 2] = '|';
            }
            line[usize::from(row.lane) * 2] = match parents.len() {
                0 => 'o',
                1 => '*',
                _ => 'M',
            };
            let line: String = line.into_iter().collect();
            if names {
                out += &format!("{line}  {oid}\n");
            } else {
                out += &format!("{}\n", line.trim_end());
            }
            if row.edges.iter().all(|e| e.from == e.to) {
                continue;
            }
            let mut conn = vec![' '; pad];
            for e in row
                .edges
                .iter()
                .filter(|e| e.kind != EdgeKind::Top && e.from == e.to)
            {
                conn[usize::from(e.to) * 2] = '|';
            }
            for e in row.edges.iter().filter(|e| e.from != e.to) {
                let (a, b) = (usize::from(e.from) * 2, usize::from(e.to) * 2);
                let (diagonal, dash, glyph) = if a < b {
                    (b - 1, a + 1..b - 1, '\\')
                } else {
                    (b + 1, b + 2..a, '/')
                };
                for i in dash {
                    if conn[i] == ' ' {
                        conn[i] = '-';
                    }
                }
                conn[diagonal] = match conn[diagonal] {
                    ' ' | '-' => glyph,
                    c if c == glyph => glyph,
                    _ => 'X',
                };
            }
            let conn: String = conn.into_iter().collect();
            out += &format!("{}\n", conn.trim_end());
        }
        out
    }

    #[track_caller]
    fn assert_graph(spec: &str, head: Option<&str>, expected: &str) {
        let actual = render(&history(spec), head, true);
        let expected = expected.strip_prefix('\n').unwrap_or(expected);
        assert!(actual == expected, "graph mismatch, got:\n{actual}");
    }

    #[test]
    fn linear_history() {
        assert_graph(
            "d c
             c b
             b a
             a",
            None,
            r"
*   d
*   c
*   b
o   a
",
        );
    }

    #[test]
    fn simple_merge() {
        // Date order: main moved on before the feature's first commit.
        assert_graph(
            "M m2 f2
             f2 f1
             m2 b
             f1 b
             b a
             a",
            None,
            r"
M     M
|\
| *   f2
* |   m2
| *   f1
|/
*     b
o     a
",
        );
        // Topological order: the feature is listed before main's side.
        assert_graph(
            "M m2 f2
             f2 f1
             f1 b
             m2 b
             b a
             a",
            None,
            r"
M     M
|\
| *   f2
| *   f1
* |   m2
|/
*     b
o     a
",
        );
    }

    #[test]
    fn octopus_merge() {
        assert_graph(
            "O m f1 f2 f3
             f3 b
             f2 b
             f1 b
             m b
             b",
            None,
            r"
M         O
|\-\-\
| | | *   f3
| | * |   f2
| | |/
| * |     f1
| |/
* |       m
|/
o         b
",
        );
    }

    #[test]
    fn criss_cross_merge() {
        assert_graph(
            "M a2 b2
             a2 A
             b2 B
             A a1 b1
             B b1 a1
             a1 x
             b1 x
             x",
            None,
            r"
M       M
|\
* |     a2
| *     b2
M |     A
|-|\
| M |   B
|/|/
* |     a1
| *     b1
|/
o       x
",
        );
    }

    #[test]
    fn many_parallel_branches() {
        let spec = "m3 m2
                    f1b f1a
                    f2b f2a
                    f3b f3a
                    f4b f4a
                    f5b f5a
                    f6b f6a
                    m2 m1
                    f1a m1
                    f6a m1
                    f3a m1
                    f4a m1
                    f2a m1
                    f5a m1
                    m1";
        assert_graph(
            spec,
            None,
            r"
*               m3
| *             f1b
| | *           f2b
| | | *         f3b
| | | | *       f4b
| | | | | *     f5b
| | | | | | *   f6b
* | | | | | |   m2
| * | | | | |   f1a
|/  | | | | |
|   | | | | *   f6a
|/--|-|-|-|-
|   | * | |     f3a
|/--|-  | |
|   |   * |     f4a
|/--|---  |
|   *     |     f2a
|/--      |
|         *     f5a
|/--------
o               m1
",
        );
        let rows = layout(&history(spec), None);
        let colors: Vec<u8> = rows[..7].iter().map(|r| r.color).collect();
        assert_eq!(colors, [1, 2, 3, 4, 5, 6, 7]);
    }

    #[test]
    fn orphan_branches() {
        assert_graph(
            "m2 m1
             g2 g1
             m1
             h2 h1
             g1
             h1",
            None,
            r"
*     m2
| *   g2
o |   m1
* |   h2
| o   g1
o     h1
",
        );
    }

    #[test]
    fn shallow_clone() {
        // c0 and x9 lie beyond the shallow boundary and never arrive.
        assert_graph(
            "c3 c2
             c2 c1 x9
             c1 c0",
            None,
            r"
*     c3
M     c2
|\
* |   c1
",
        );
    }

    #[test]
    fn long_lived_lane() {
        // main merges one short feature branch per cycle while `release`, forked at the root,
        // stays open in lane 2 until the end.
        const CYCLES: usize = 70;
        let mut spec = String::from(
            "M0 m0 f0
release base
",
        );
        for k in 0..CYCLES {
            if k > 0 {
                spec += &format!(
                    "M{k} m{k} f{k}
"
                );
            }
            let next = if k + 1 == CYCLES {
                "base".to_owned()
            } else {
                format!("M{}", k + 1)
            };
            spec += &format!(
                "f{k} {next}
m{k} {next}
"
            );
        }
        spec += "base
";
        let history = history(&spec);
        let rows = layout(&history, None);

        let release = Edge {
            from: 2,
            to: 2,
            color: rows[1].color,
            kind: EdgeKind::Through,
        };
        let open = &rows[2..rows.len() - 3];
        assert!(open.len() >= 200);
        assert!(open.iter().all(|r| r.edges.contains(&release)));

        let start = r"
M
|\
| | *
| * |
* | |
|/  |
";
        let cycle = r"M   |
|\  |
| * |
* | |
|/  |
";
        let end = r"M   |
|\  |
| * |
| |/
* |
|/
o
";
        let expected = [&start[1..], &cycle.repeat(CYCLES - 2), end].concat();
        let actual = render(&history, None, false);
        assert!(
            actual == expected,
            "graph mismatch, got:
{actual}"
        );
    }

    #[test]
    fn head_lane_gets_accent_colour() {
        // HEAD is a branch tip.
        let rows = layout(&history("m2 m1\nf2 f1\nf1 m1\nm1"), Some("f2"));
        assert_eq!(rows[1].color, HEAD_COLOR);
        assert_eq!(rows[2].color, HEAD_COLOR);
        assert_only_head_lane_is_accent(&rows);
        // HEAD was merged into a branch shown above it: the lane created for it is accent.
        let rows = layout(&history("M m1 f1\nf1 b\nm1 b\nb"), Some("f1"));
        assert_eq!(rows[1].color, HEAD_COLOR);
        assert_only_head_lane_is_accent(&rows);
        // HEAD is reached in a lane that started above it: no colour jump.
        let rows = layout(&history("m2 m1\nm1 m0\nm0"), Some("m1"));
        assert!(rows.iter().all(|r| r.color != HEAD_COLOR));
        assert_only_head_lane_is_accent(&rows);
    }

    /// At most one lane carries colour 0 at any time.
    fn assert_only_head_lane_is_accent(rows: &[GraphRow]) {
        for row in rows {
            let accent: HashSet<u16> = row
                .edges
                .iter()
                .filter(|e| e.color == HEAD_COLOR && e.kind == EdgeKind::Through)
                .map(|e| e.from)
                .chain((row.color == HEAD_COLOR).then_some(row.lane))
                .collect();
            assert!(accent.len() <= 1, "{row:?}");
        }
    }

    /// Small deterministic generator (Knuth's MMIX LCG).
    struct Lcg(u64);

    impl Lcg {
        fn below(&mut self, n: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((self.0 >> 33) % n as u64) as usize
        }
    }

    /// Random history in creation order (parents are always older), with up to `branches`
    /// branches open at once, orphan roots, merges, octopus and criss-cross merges. New
    /// branches and extra merge parents start at most `reach` commits back.
    fn random_dag(rng: &mut Lcg, n: usize, branches: usize, reach: usize) -> Vec<Vec<usize>> {
        let mut heads = vec![0];
        let mut dag = vec![vec![]];
        for i in 1..n {
            let roll = rng.below(100);
            let mut parents = Vec::new();
            if roll < 2 {
                heads.push(i);
            } else if roll < 15 && heads.len() < branches {
                parents.push(i - 1 - rng.below(i.min(reach)));
                heads.push(i);
            } else {
                let k = rng.below(heads.len());
                parents.push(heads[k]);
                heads[k] = i;
                if roll >= 80 {
                    let j = rng.below(heads.len());
                    if j != k {
                        parents.push(heads[j]);
                        if roll < 92 {
                            heads.swap_remove(j);
                        }
                    }
                }
                if roll >= 95 {
                    parents.push(i - 1 - rng.below(i.min(reach)));
                }
            }
            parents.dedup();
            dag.push(parents);
        }
        dag
    }

    /// A valid display order (children first): repeatedly emits the ready commit with the
    /// latest skewed date, or the most recently readied one when `stack` (topo-order-like).
    fn display_order(rng: &mut Lcg, dag: &[Vec<usize>], stack: bool) -> Vec<usize> {
        let mut children = vec![0usize; dag.len()];
        for parents in dag {
            for &p in parents {
                children[p] += 1;
            }
        }
        let date: Vec<usize> = (0..dag.len()).map(|i| i * 10 + rng.below(40)).collect();
        let mut ready: BinaryHeap<(usize, usize)> = BinaryHeap::new();
        let mut lifo = Vec::new();
        for i in (0..dag.len()).filter(|&i| children[i] == 0) {
            ready.push((date[i], i));
            lifo.push(i);
        }
        let mut order = Vec::new();
        while let Some(c) = if stack {
            lifo.pop()
        } else {
            ready.pop().map(|(_, c)| c)
        } {
            order.push(c);
            for &p in &dag[c] {
                children[p] -= 1;
                if children[p] == 0 {
                    ready.push((date[p], p));
                    lifo.push(p);
                }
            }
        }
        order
    }

    fn oid(i: usize) -> String {
        format!("{i:040x}")
    }

    fn to_history(dag: &[Vec<usize>], order: &[usize]) -> History {
        order
            .iter()
            .map(|&c| (oid(c), dag[c].iter().map(|&p| oid(p)).collect()))
            .collect()
    }

    #[test]
    fn random_dags_satisfy_the_contract() {
        for seed in 0..300u64 {
            let mut rng = Lcg(seed);
            let n = 1 + rng.below(250);
            let branches = 2 + rng.below(12);
            let dag = random_dag(&mut rng, n, branches, n);
            let mut order = match seed % 3 {
                0 => (0..n).rev().collect(),
                1 => display_order(&mut rng, &dag, false),
                _ => display_order(&mut rng, &dag, true),
            };
            assert_eq!(order.len(), n);
            if seed % 5 == 0 {
                order.truncate(n - n / 4); // shallow: the oldest parents never arrive
            }
            let history = to_history(&dag, &order);
            let head = (seed % 4 != 0).then(|| history[rng.below(history.len())].0.clone());
            let rows = layout(&history, head.as_deref());
            assert_eq!(rows, layout(&history, head.as_deref()), "deterministic");
            check_head_colour(&history, &rows, head.as_deref());
        }
    }

    /// Colour 0 is used only by the lane created for HEAD: HEAD's dot is accent when HEAD is
    /// a tip, never when a lane already running above reaches it.
    fn check_head_colour(history: &History, rows: &[GraphRow], head: Option<&str>) {
        assert_only_head_lane_is_accent(rows);
        let Some(head) = head else {
            assert!(
                rows.iter()
                    .flat_map(|r| &r.edges)
                    .all(|e| e.color != HEAD_COLOR)
            );
            return;
        };
        let at = history.iter().position(|(oid, _)| oid == head).unwrap();
        let first_reference = history[..at]
            .iter()
            .find_map(|(_, parents)| parents.iter().position(|p| p == head));
        match first_reference {
            None => assert_eq!(rows[at].color, HEAD_COLOR),
            Some(0) => assert_ne!(rows[at].color, HEAD_COLOR),
            Some(_) => {}
        }
        for row in &rows[..at] {
            let accent = row.edges.iter().any(|e| e.color == HEAD_COLOR);
            assert!(!accent || first_reference.is_some_and(|i| i > 0));
        }
    }

    #[test]
    #[ignore = "benchmark: cargo test --release -- --ignored --nocapture"]
    fn lays_out_100k_commits_quickly() {
        let mut rng = Lcg(42);
        let n = 100_000;
        let dag = random_dag(&mut rng, n, 40, 500);
        let history = to_history(&dag, &(0..n).rev().collect::<Vec<_>>());
        let start = Instant::now();
        let mut builder = GraphBuilder::new(Some(&history[0].0));
        let mut widest = 0;
        for (oid, parents) in &history {
            widest = widest.max(builder.push(oid, parents).width);
        }
        let elapsed = start.elapsed();
        println!("{n} commits in {elapsed:?}, widest row {widest} lanes");
        assert!(elapsed.as_secs_f64() < 1.0);
    }
}
