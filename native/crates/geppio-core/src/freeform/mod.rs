//! GeppIO's freeform adapters (`src/geppio/src/shared/freeform/`): region policy, the
//! bundled fixture constraints, stable viewport projection, the freeform geometry codec and
//! the minimal region transfer route.
#![warn(missing_docs)]
pub mod policy;
pub mod projection;
pub mod schema;
pub mod transfer;

pub use policy::{
    CONSTRAINTS_IDS, EXPANSION_KEY, FREEFORM_KEY, constraint_in_region, constraints,
    constraints_for, default_freeform,
};
pub use projection::{Projection, project_region};
pub use schema::{CodecError, Layout, parse_freeform, parse_geometry};
pub use transfer::{region_label, transfer};
