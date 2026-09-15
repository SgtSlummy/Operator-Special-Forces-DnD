---
name: The Unwritten Coast
description: An illustrated coastal campaign table in sea-green and brass.
colors:
  sea-depth: "#101e23"
  parchment: "#eee6d5"
  control-surface: "#172a30"
  control-border: "#516064"
  brass: "#c5a371"
  brass-ink: "#132327"
  focus-light: "#f0cc90"
  control-hover: "#304348"
  drawer-surface: "#1a3037"
  drawer-border: "#52646a"
  dock-surface: "#11262df5"
  dock-border: "#526068"
typography:
  display:
    fontFamily: "Coast, Georgia, serif"
    fontSize: "clamp(32px, 3.3vw, 52px)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-.025em"
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.65
rounded:
  stage: "4px"
  control: "5px"
  drawer: "9px"
spacing:
  article-block: "28px"
  article-inline: "36px"
  reading-gap: "40px"
  compact-article: "22px"
components:
  button-primary:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.brass-ink}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.control}"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  input:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.control}"
  drawer:
    backgroundColor: "{colors.drawer-surface}"
    rounded: "{rounded.drawer}"
---

# Design System: The Unwritten Coast

## Overview

**Creative North Star: "The Coastal Campaign Book"**

This is a descriptive record of the implemented campaign table, extracted from the current stylesheet and desktop/mobile captures. The metaphor and color names describe the observed result; they do not represent an additional user approval of visual details.

Deep sea-green surfaces surround warm illustrated places. Brass accents, pale text, and the self-hosted literary serif give the table the character of a coastal campaign book. The scene carries the atmosphere; compact practical controls support play around it.

**Key Characteristics:**
- Large, richly illustrated scene imagery.
- Sea-green surfaces, brass actions, and pale reading text.
- Literary display type paired with practical sans-serif controls.
- Persistent navigation with private character and equipment drawers.

## Colors

The palette pairs cool dark surfaces with warm brass and pale reading text; the frontmatter contains the normative values.

### Primary
- **Brass:** Primary actions and selected emphasis.
- **Brass Ink:** Dark text on brass actions.
- **Focus Light:** High-visibility keyboard focus outlines.

### Neutral
- **Sea Depth:** The continuous page background.
- **Parchment:** Main text and labels.
- **Control Surface / Control Hover:** Resting and hovered interactive surfaces.
- **Control Border:** Quiet field and button boundaries.
- **Drawer Surface / Drawer Border:** Raised private panels.
- **Dock Surface / Dock Border:** The persistent navigation strip and its separating edge.

## Typography

**Display Font:** Self-hosted Cormorant Garamond, named `Coast` in CSS, with Georgia and serif fallbacks.

**Body Font:** Segoe UI, system-ui, sans-serif.

The display face gives place names and narrative headings a book-like voice. Sans-serif text keeps controls and longer practical instructions legible. The display and body roles follow the frontmatter. At the narrow breakpoint the main title uses (33px).

## Layout

The desktop shell has a maximum width of (1680px), with a (235px) atlas sidebar and a flexible article. Article padding is (28px 36px). Below the scene, narrative and annotations share a (1.5fr / 1fr) grid with a (40px) gap.

At (1100px), the sidebar narrows to (190px) and article padding becomes (22px). At (760px), the atlas becomes a horizontal strip and the content becomes a single column. Scene-view tabs remain a compact horizontal sequence. The mobile capture shows the art cropped to fit the narrow stage while preserving its environmental character.

The bottom navigation stays available during scrolling. Private panels sit above it; their desktop geometry is right (18px), top (100px), bottom (106px), and width `min(570px, calc(100vw - 36px))`.

## Elevation & Depth

Dark tonal layers and thin borders establish most boundaries. The large scene has a soft shadow (`0 14px 32px #070f1459`); private drawers have a deeper structural shadow (`-16px 14px 65px #0009`). The dock uses a nearly opaque surface above the reading content.

## Shapes

Controls use gently rounded corners, the image stage is nearly square, and private drawers are slightly softer. The frontmatter records their three radii. Fine borders and rectangular reading surfaces recur throughout the interface. Functional icons are inline SVG, typically (22px) with a (1.5px) stroke.

## Components

### Buttons

Primary actions use brass with dark lettering. Secondary actions use the control surface and pale text. Hover changes the background to the hover surface; background and color transitions run for (180ms). Keyboard focus uses a (3px) focus-light outline with a (4px) offset. Reduced-motion preferences remove transitions.

### Inputs / Fields

Inputs and selects share the control surface, fine control border, and control radius. Disabled company-view controls communicate that a private player link is needed before submitting an action.

### Navigation

The atlas pairs scene thumbnails with place names and discovery state. A horizontal set of scene-view tabs separates the title from the artwork. The persistent bottom dock provides Scene, Atlas, Character, Inventory, Shop, Journal, and Raphael destinations with functional SVG icons. Its labels remain visible on mobile.

### Scene Stage

Existing rich scene artwork supplies the environment, with a small contextual caption along its lower edge. Narrative text follows the image instead of being embedded into it. Six locally generated Stable Diffusion portraits extend the same illustrated treatment to the party.

### Private Drawers

Private character and equipment surfaces use the drawer tokens, border, and structural shadow. Their raised placement separates personal details from the shared scene while keeping the navigation available.

## Do's and Don'ts

### Do:
- **Do** preserve the sea-green, brass, and pale-text relationship when extending the table.
- **Do** use the self-hosted display face for literary hierarchy and sans-serif text for controls.
- **Do** keep scene artwork, portraits, and functional SVG icons in their observed roles.
- **Do** retain visible keyboard focus, reduced-motion behavior, and mobile navigation access.

### Don't:
- **Don't** replace the rich scene artwork with decorative SVG approximations.
- **Don't** use this visual record as evidence of user approval or Discord deployment.
- **Don't** treat the shared company view as authorization to expose private player information.
