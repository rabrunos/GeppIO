//! Region policy and the bundled fixture constraints (`freeform/policy.ts`).
use super::schema::Layout;
use crate::js;
use crate::layout::policy::MAX_SIZE;
use crate::layout::{Constraint, Constraints, PerRegion, Placement, Region, Size, Surface};

/// Storage key of the preserved alpha.12 freeform document.
pub const FREEFORM_KEY: &str = "geppio:layout:freeform:v1";
/// Storage key of the horizontal expansion option.
pub const EXPANSION_KEY: &str = "geppio:layout:expansion:v1";

fn define(width: f64, height: f64, regions: &[Region], dw: f64, dh: f64) -> Constraint {
    Constraint {
        min: Size::new(width, height),
        default: Size::new(dw, dh),
        max: Size::new(MAX_SIZE, MAX_SIZE),
        resize_x: true,
        resize_y: true,
        region_min: PerRegion::default(),
        regions: regions.to_vec(),
    }
}

/// Identities of the seven fixture widgets, in declaration order (`IDS`).
pub const CONSTRAINTS_IDS: [&str; 7] = [
    "summary",
    "queue",
    "library",
    "notes",
    "activity",
    "properties",
    "chart",
];

/// Content minima of the fixture widgets, independent of permissions and theme (`CONSTRAINTS`).
pub fn constraints() -> Constraints {
    use Region::{Bottom, Main, Sidebar};
    let all = [Main, Sidebar, Bottom];
    let side = [Main, Sidebar];
    [
        ("summary", define(164.0, 112.0, &all, 230.0, 140.0)),
        ("queue", define(240.0, 160.0, &[Main], 400.0, 300.0)),
        ("library", define(180.0, 150.0, &side, 310.0, 230.0)),
        ("notes", define(164.0, 160.0, &side, 230.0, 300.0)),
        ("activity", define(180.0, 160.0, &side, 310.0, 380.0)),
        ("properties", define(240.0, 174.0, &side, 400.0, 310.0)),
        ("chart", define(164.0, 112.0, &all, 230.0, 160.0)),
    ]
    .into_iter()
    .map(|(id, c)| (id.to_owned(), c))
    .collect()
}

/// The historical default freeform scene (`DEFAULT_FREEFORM`).
pub fn default_freeform() -> Layout {
    let cs = constraints();
    let seeds = [
        ("summary", 0.0, 0.0),
        ("queue", 240.0, 0.0),
        ("library", 650.0, 0.0),
        ("notes", 0.0, 150.0),
        ("activity", 650.0, 240.0),
        ("properties", 240.0, 310.0),
        ("chart", 0.0, 460.0),
    ];
    Layout {
        reference: PerRegion {
            main: Size::new(960.0, 620.0),
            sidebar: Size::new(185.0, 320.0),
            bottom: Size::new(960.0, 128.0),
        },
        placements: seeds
            .iter()
            .map(|&(id, x, y)| {
                let d = cs.get(id).expect("fixture constraint").default;
                Placement {
                    id: id.to_owned(),
                    region: Region::Main,
                    x,
                    y,
                    width: d.width,
                    height: d.height,
                    preferred: d,
                }
            })
            .collect(),
    }
}

/// The constraint with the region's responsive minimum applied (`constraintInRegion`).
pub fn constraint_in_region(constraint: &Constraint, region: Region) -> Constraint {
    match constraint.region_min.get(region) {
        Some(min) => Constraint {
            min: *min,
            ..constraint.clone()
        },
        None => constraint.clone(),
    }
}

/// Constraints as a surface's solver sees them: Sidebar width and Bottom height follow the
/// surface and are not resizable (`constraintsFor`).
pub fn constraints_for(surface: &Surface, constraints: &Constraints) -> Constraints {
    constraints.map(|declared| {
        let c = constraint_in_region(declared, surface.region);
        Constraint {
            min: Size::new(
                if surface.region == Region::Sidebar {
                    js::max(c.min.width, surface.width)
                } else {
                    c.min.width
                },
                if surface.region == Region::Bottom {
                    js::max(c.min.height, surface.height)
                } else {
                    c.min.height
                },
            ),
            max: Size::new(
                if surface.region == Region::Sidebar {
                    surface.width
                } else {
                    c.max.width
                },
                if surface.region == Region::Bottom {
                    surface.height
                } else {
                    c.max.height
                },
            ),
            resize_x: c.resize_x && surface.region != Region::Sidebar,
            resize_y: c.resize_y && surface.region != Region::Bottom,
            ..c
        }
    })
}
