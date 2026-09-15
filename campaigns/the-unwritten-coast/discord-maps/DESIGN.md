---
name: The Unwritten Coast Map Table
description: Architectural fantasy maps with legible manual player markers.
colors:
  paper: "#f4efe5"
  panel: "#e9e2d3"
  ink: "#233c3d"
  muted: "#526465"
  line: "#c4bcac"
  accent: "#245d61"
  white: "#fffcf5"
  focus: "#ad482b"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "clamp(28px, 3vw, 43px)"
    fontWeight: 400
    letterSpacing: "-.025em"
  headline:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "28px"
    fontWeight: 400
  title:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "22px"
    fontWeight: 400
  body:
    fontFamily: "'Segoe UI', sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
rounded:
  control: "5px"
spacing:
  mobile-page: "16px"
  desktop-page: "32px"
  map-gap: "24px"
components:
  button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-export:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  floor-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "0"
    padding: "12px 16px"
---

# Design System: The Unwritten Coast Map Table

## Overview

The visual direction is a detailed fantasy architectural atlas, grounded in the user's stone, brass, water, and parchment references. This record describes the shipped isolated map viewer; it does not establish rules for the surrounding campaign project.

The maps carry the atmosphere. Restrained paper surfaces, serif headings, and clear controls keep the GM's attention on architecture and player positions.

**Key Characteristics:**

- Original architectural imagery with retained provenance.
- Map-led composition with paired overview and floor slice.
- Numbered markers and readable names supplement player colors.

## Colors

The muted teal primary accent sits against warm paper neutrals. Token values above are normative.

### Primary

- **Accent:** selected floors, export actions, links, and checked controls.
- **Focus:** a distinct warm outline for keyboard focus.

### Neutral

- **Paper / panel / white:** page, supporting surfaces, and controls.
- **Ink / muted:** primary text and explanatory text.
- **Line:** map frames, dividers, and control borders.

The cream palette is intentionally retained because it follows the supplied reference art; the mechanical cream-palette warning is accepted for this surface.

## Typography

Georgia headings provide the atlas character. Segoe UI keeps operating instructions and player names readable. Display, headline, title, and body roles use the frontmatter scale; headings are regular weight. Small secondary labels communicate floor elevation and supporting information.

## Layout

The container caps at 1600px. Desktop page padding uses the desktop-page token. Overview and slice share a grid in .66fr / 1.34fr proportions; the slice receives the larger area. At 900px and below, padding becomes 20px and the grid uses .8fr / 1.2fr proportions. At 620px and below, full maps stack, page padding uses mobile-page, floor navigation scrolls horizontally, and the roster forms two columns. At 1100px and above the slice has no viewport-height cap.

Export status stays in normal document flow immediately below export controls. It must not cover map content.

## Elevation & Depth

The application uses borders and tonal separation rather than decorative cards. Architectural depth belongs to the map imagery. Small shadows distinguish marker coins and their name tags from busy map details; they do not imply raised application panels.

## Shapes

Controls use modestly rounded corners. Maps have a thin line-colored frame. Floor tabs have square corners, while player markers are circular with white rings. Keep image proportions intact.

## Components

### Buttons and inputs

Ordinary controls use the white surface and ink text; export buttons use accent and white. Controls have a minimum height of 44px. Hover darkens or tints the surface. Keyboard focus uses a 3px focus-colored outline with a 3px offset. Disabled buttons use half opacity and the unavailable cursor.

### Floor navigation

Horizontal floor buttons show a name and elevation. The selected floor uses a solid accent background. Mobile tabs remain wide enough to read and scroll horizontally.

### Maps and markers

Overview and slice show synchronized manual player positions. The selected marker's label remains visible; hover and keyboard focus also reveal labels. White-ring numbered coins supplement vermilion, blue, violet, green, ochre, and rose identities. The roster supplies names and floor locations. Marker targets are smaller than general controls; no claim of universal 44px targets is made.

### Status and motion

Export feedback follows its controls in normal flow. Button surface transitions last .16s with ease-out; reduced-motion preference disables transitions and smooth scrolling.

## Do's and Don'ts

- **Do** preserve map detail and image proportions.
- **Do** keep player numbers, names, and floor information available alongside color.
- **Do** retain visible keyboard focus and reduced-motion support.
- **Don't** place sticky status feedback over the maps.
- **Don't** turn the surrounding controls into decorative cards.
- **Don't** treat these scoped visual choices as a redesign of the campaign project.
