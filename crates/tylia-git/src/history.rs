//! History rows for the UI: the log stream with graph layout attached, in a compact form.
//!
//! [`GraphBuilder`] emits every edge of every row, and on branchy histories almost all of
//! them are lanes running straight through (97% of 7.3 million edges on `git/git`). Those are
//! merged here into vertical [`Segment`]s spanning many rows, so a row only carries its dot
//! and its curves (lane changes).

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::graph::{Edge, EdgeKind, GraphBuilder, GraphRow};
use crate::log::LogOptions;
use crate::runner::Git;

/// A row's dot and curves; straight lines are in [`Segment`]s.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphCell {
    pub lane: u16,
    /// Palette index 0–7 (0 = the checked-out branch).
    pub color: u8,
    pub is_merge: bool,
    /// Lanes in use in this row (for sizing the graph column).
    pub width: u16,
    /// Edges that change lanes (`from != to`), drawn as curves within the row.
    pub curves: Vec<Edge>,
}

/// A straight vertical line: `[lane, color, start, end]`, where `start` and `end` are in
/// half rows from the top of the history (`2 * row` is a row's top edge, `2 * row + 1` its
/// centre).
pub type Segment = [u32; 4];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryRow {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    #[ts(type = "number")]
    pub time: i64,
    pub subject: String,
    pub graph: GraphCell,
}

/// A batch of rows with the segments that ended within it, plus the segments still open
/// at its end (provisional: each batch's `open` replaces the previous one).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryBatch {
    pub rows: Vec<HistoryRow>,
    pub segments: Vec<Segment>,
    pub open: Vec<Segment>,
}

/// Merges straight edges row by row into segments.
#[derive(Debug, Default)]
pub struct SegmentTracker {
    /// Per lane: the open segment's colour, start and current end.
    open: Vec<Option<(u8, u32, u32)>>,
    row: u32,
}

impl SegmentTracker {
    /// Adds a row's straight edges; returns its curves and pushes closed segments.
    pub fn push(&mut self, row: &GraphRow, closed: &mut Vec<Segment>) -> Vec<Edge> {
        let top = self.row * 2;
        let mut curves = Vec::new();
        for edge in &row.edges {
            if edge.from != edge.to {
                curves.push(*edge);
                continue;
            }
            let (a, b) = match edge.kind {
                EdgeKind::Top => (top, top + 1),
                EdgeKind::Bottom => (top + 1, top + 2),
                EdgeKind::Through => (top, top + 2),
            };
            let lane = edge.from as usize;
            if self.open.len() <= lane {
                self.open.resize(lane + 1, None);
            }
            match &mut self.open[lane] {
                Some((color, _, end)) if *color == edge.color && *end >= a => *end = (*end).max(b),
                slot => {
                    if let Some((color, start, end)) = slot.take() {
                        closed.push([lane as u32, color as u32, start, end]);
                    }
                    *slot = Some((edge.color, a, b));
                }
            }
        }
        // Lanes that weren't continued to this row's bottom edge end here.
        for (lane, slot) in self.open.iter_mut().enumerate() {
            if let Some((color, start, end)) = *slot
                && end < top + 2
            {
                closed.push([lane as u32, color as u32, start, end]);
                *slot = None;
            }
        }
        self.row += 1;
        curves
    }

    /// Segments still open, ending at the last row pushed.
    pub fn open(&self) -> Vec<Segment> {
        self.open
            .iter()
            .enumerate()
            .filter_map(|(lane, s)| s.map(|(c, start, end)| [lane as u32, c as u32, start, end]))
            .collect()
    }
}

impl Git {
    /// [`Git::stream_log`] with graph layout, as [`HistoryBatch`]es. `head` is the commit HEAD
    /// points at (its lane gets the accent colour); `None` resolves it here.
    pub async fn stream_history<F>(
        &self,
        repo: &Path,
        opts: LogOptions,
        head: Option<&str>,
        mut on_batch: F,
    ) -> Result<usize, GitError>
    where
        F: FnMut(HistoryBatch) -> bool,
    {
        let resolved = match head {
            Some(h) => Some(h.to_owned()),
            None => self.head_oid(repo).await?,
        };
        let mut graph = GraphBuilder::new(resolved.as_deref());
        let mut segments = SegmentTracker::default();
        self.stream_log(repo, opts, |batch| {
            let mut closed = Vec::new();
            let rows = batch
                .into_iter()
                .map(|c| {
                    let g = graph.push(&c.oid, &c.parents);
                    let curves = segments.push(&g, &mut closed);
                    HistoryRow {
                        graph: GraphCell {
                            lane: g.lane,
                            color: g.color,
                            is_merge: g.is_merge,
                            width: g.width,
                            curves,
                        },
                        oid: c.oid,
                        parents: c.parents,
                        author_name: c.author_name,
                        author_email: c.author_email,
                        time: c.time,
                        subject: c.subject,
                    }
                })
                .collect();
            on_batch(HistoryBatch {
                rows,
                segments: closed,
                open: segments.open(),
            })
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(from: u16, to: u16, color: u8, kind: EdgeKind) -> Edge {
        Edge {
            from,
            to,
            color,
            kind,
        }
    }

    fn row(lane: u16, edges: Vec<Edge>) -> GraphRow {
        GraphRow {
            lane,
            color: 0,
            is_merge: false,
            edges,
            width: 2,
        }
    }

    #[test]
    fn merges_straight_runs_and_keeps_curves() {
        use EdgeKind::*;
        let mut t = SegmentTracker::default();
        let mut closed = Vec::new();
        // Row 0: tip on lane 0, forks to lane 1 (curve).
        let curves = t.push(
            &row(0, vec![edge(0, 0, 0, Bottom), edge(0, 1, 2, Bottom)]),
            &mut closed,
        );
        assert_eq!(curves.len(), 1);
        // Row 1: commit on lane 0, lane 1 passes through.
        t.push(
            &row(
                0,
                vec![
                    edge(0, 0, 0, Top),
                    edge(0, 0, 0, Bottom),
                    edge(1, 1, 2, Through),
                ],
            ),
            &mut closed,
        );
        // Row 2: root commit on lane 1 (lane 0 continues).
        t.push(
            &row(1, vec![edge(0, 0, 0, Through), edge(1, 1, 2, Top)]),
            &mut closed,
        );
        // Lane 1 started at row 1's top (2), ends at row 2's centre (5).
        assert_eq!(closed, vec![[1, 2, 2, 5]]);
        // Lane 0 runs from row 0's centre (1) to the bottom of row 2 (6), still open.
        assert_eq!(t.open(), vec![[0, 0, 1, 6]]);
    }

    #[test]
    fn colour_change_starts_a_new_segment() {
        use EdgeKind::*;
        let mut t = SegmentTracker::default();
        let mut closed = Vec::new();
        t.push(&row(0, vec![edge(0, 0, 1, Through)]), &mut closed);
        t.push(&row(0, vec![edge(0, 0, 3, Through)]), &mut closed);
        assert_eq!(closed, vec![[0, 1, 0, 2]]);
        assert_eq!(t.open(), vec![[0, 3, 2, 4]]);
    }
}
