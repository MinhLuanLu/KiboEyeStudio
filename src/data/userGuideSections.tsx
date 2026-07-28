import type { ReactNode } from 'react'
import {
  GuideCallout,
  GuideCode,
  GuideControlRow,
  GuideH3,
  GuideOl,
  GuideP,
  GuideTable,
  GuideTutorial,
  GuideUl,
  KeyCap,
  KeyCombo
} from '@/components/Guide/GuideElements'
import { EasingCurvesDiagram, TimelineAnatomyDiagram } from '@/components/Guide/GuideDiagrams'

export interface GuideSection {
  id: string
  title: string
  /** Sections that share a group render as a nested list under one heading in the sidebar
   * (used only for the 18 Animation Guide subsections — everything else is top-level). */
  group?: string
  content: ReactNode
}

// ---------------------------------------------------------------------------------------
// 1. Welcome
// ---------------------------------------------------------------------------------------

const welcome: GuideSection = {
  id: 'welcome',
  title: 'Welcome',
  content: (
    <>
      <GuideP>
        Kibo  Studio is a desktop app for designing procedural robot-eye animations — two eyes, rendered live on a simulated
        round display — and exporting them as ready-to-flash C++ code for an ESP32-C6 driving a 240×240 GC9A01 display. Every
        eye is built entirely from numbers (widths, positions, colors, curves), not artwork or video, so it renders identically
        in the preview and on the real hardware, and animates smoothly at any size.
      </GuideP>
      <GuideP>With it you can:</GuideP>
      <GuideUl>
        <li>Design static eye looks — <strong>Expressions</strong> — like Neutral, Happy, or Sleepy.</li>
        <li>Sequence those looks over time into <strong>Animations</strong> — Blink, Look Left, Wake Up, and so on.</li>
        <li>Preview everything live, exactly as it will appear on the real display.</li>
        <li>Save your work as an editable project file and come back to it later.</li>
        <li>Export the finished result as a self-contained C++ header for your ESP32 sketch.</li>
      </GuideUl>

      <GuideH3>How the pieces fit together</GuideH3>
      <GuideUl>
        <li>
          An <strong>Expression</strong> is one complete, static eye pose — every slider and color at a single moment in time.
        </li>
        <li>
          A <strong>Keyframe</strong> is one complete eye pose <em>plus a place in time</em> — it's what an animation is actually
          built from. A keyframe's shape is edited with the exact same Controls/Colors panels you use to design an Expression.
        </li>
        <li>
          A <strong>Transition</strong> (also called a <em>segment</em>) is the stretch of time and the easing curve between two
          consecutive keyframes — it's what the eye is doing <em>between</em> two poses, not a pose itself.
        </li>
        <li>
          An <strong>Animation</strong> is an ordered list of keyframes played back in sequence, e.g. "Blink" = open → closed →
          open, each pair connected by a transition.
        </li>
      </GuideUl>

      <GuideCallout tone="note">
        Designing a static <strong>Expression</strong> and building an <strong>Animation</strong> use the very same sliders and
        color pickers — the only difference is what you do with the result afterward. Save a pose as a named Expression to reuse
        it later (as a resting look, or as a starting point for a keyframe); add poses as keyframes on a timeline when you want
        the eye to move from one look to another over time.
      </GuideCallout>

      <GuideH3>The recommended workflow</GuideH3>
      <GuideOl>
        <li>Create or open a project.</li>
        <li>Design eye expressions in the Controls / Colors panels.</li>
        <li>Build an animation on the timeline out of keyframes (start from an expression's look, then adjust).</li>
        <li>Adjust each keyframe's timing and easing (transitions).</li>
        <li>Preview the animation in Animate mode.</li>
        <li>
          Save the editable project (<KeyCombo mac={['⌘', 'S']} winLinux={['Ctrl', 'S']} />).
        </li>
        <li>Export the animation as C++ for your ESP32 sketch.</li>
      </GuideOl>
      <GuideP>
        The rest of this guide follows that same order — start with <em>Getting Started</em>, then <em>Eye/Pupil/Eyelid
        Controls</em> and <em>Expressions</em> to learn how to shape a single pose, then the full <em>Animation Guide</em> for
        everything about building motion.
      </GuideP>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 2. Getting Started
// ---------------------------------------------------------------------------------------

const gettingStarted: GuideSection = {
  id: 'getting-started',
  title: 'Getting Started',
  content: (
    <>
      <GuideH3>Create a new project</GuideH3>
      <GuideP>
        Use the toolbar's <strong>New</strong> button, or File → New Project (
        <KeyCombo mac={['⌘', 'N']} winLinux={['Ctrl', 'N']} />). A new project starts with a full library of 19 built-in
        animations and 14 built-in expressions already in place, ready to customize — you don't have to start from a blank
        state.
      </GuideP>
      <GuideCallout tone="note">
        If you have unsaved changes, Kibo  Studio asks before discarding them — this applies to New, Open, and closing the
        app.
      </GuideCallout>

      <GuideH3>Display resolution and FPS</GuideH3>
      <GuideP>
        Open the <strong>Display</strong> tab (right-hand panel). It controls the simulated panel, not any single eye:
      </GuideP>
      <GuideControlRow name="Shape" children={<>Circle, Square, or Rounded — matches your physical panel. GC9A01 displays are round.</>} />
      <GuideControlRow name="Display Width / Height" range="60–480 px">
        The simulated screen size in pixels. Defaults to 240×240 to match the GC9A01. A "Match Height to Width" button keeps it
        square in one click.
      </GuideControlRow>
      <GuideControlRow name="Corner Radius" range="0–160 px">Only shown when Shape is Rounded.</GuideControlRow>
      <GuideControlRow name="Display FPS" range="1–120">
        The frame rate used both for live preview playback and baked into the exported code's frame-delay constant. See{' '}
        <em>7.8 FPS and Timing</em> for how this interacts with animation speed.
      </GuideControlRow>
      <GuideControlRow name="Background Color / Show Bezel">Background color behind the eyes, and an optional decorative bezel ring around the preview.</GuideControlRow>

      <GuideH3>Open, Save, and Save As</GuideH3>
      <GuideUl>
        <li>
          <strong>Open Project</strong> — toolbar Open button, File menu, or <KeyCombo mac={['⌘', 'O']} winLinux={['Ctrl', 'O']} /> — shows a native file
          picker for a <code>.kiboeyes</code> project file.
        </li>
        <li>
          <strong>Save</strong> — <KeyCombo mac={['⌘', 'S']} winLinux={['Ctrl', 'S']} /> — writes to the file you're already
          working on. If this project has never been saved, Save behaves like Save As and asks where to put it.
        </li>
        <li>
          <strong>Save As</strong> — <KeyCombo mac={['⌘', '⇧', 'S']} winLinux={['Ctrl', 'Shift', 'S']} /> — always shows the
          file picker, letting you save under a new name/location without touching the original file (unless you deliberately
          pick the same one).
        </li>
      </GuideUl>
      <GuideCallout tone="tip">
        The toolbar always shows a plain-language save status next to the project name: <em>Not saved yet</em>,{' '}
        <em>Unsaved changes</em>, <em>✓ Saved</em>, or <em>All changes saved</em>.
      </GuideCallout>

      <GuideH3>Reopening a project</GuideH3>
      <GuideP>
        A saved <code>.kiboeyes</code> file is a complete snapshot: every expression, every animation with all of its keyframes
        and timing, display settings, colors, and which eye/expression/animation/mode you had open. Opening it puts the editor
        back exactly where you left off, ready to keep editing immediately — nothing needs to be re-created.
      </GuideP>
      <GuideP>The app also autosaves periodically in the background, and offers to restore that autosave if it ever closes unexpectedly.</GuideP>

      <GuideH3>Save Project vs. Export Code — not the same thing</GuideH3>
      <GuideTable
        headers={['', 'Save Project', 'Export']}
        rows={[
          [
            'File type',
            <code key="a">.kiboeyes</code>,
            <span key="b">
              <code>.h</code> (C++ header) or <code>.json</code>
            </span>
          ],
          ['Purpose', 'Keep editing later', 'Flash to real hardware'],
          ['Can reopen in the editor?', 'Yes — this is the only format the editor can read back in', 'No — one-way output'],
          ['Contains', 'Everything: full editable project state', 'Only the compiled data your sketch actually needs']
        ]}
      />
      <GuideCallout tone="warning">
        Exporting does <em>not</em> save your project. Always Save (or Save As) first — Export is a separate, one-way step you
        do when you're ready to flash a device. See <em>8. Export</em> for the full export workflow.
      </GuideCallout>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 3. Eye Controls
// ---------------------------------------------------------------------------------------

const eyeControls: GuideSection = {
  id: 'eye-controls',
  title: 'Eye Controls',
  content: (
    <>
      <GuideP>
        Found in the <strong>Controls</strong> tab's "Eye Shape" group, plus color/border controls in the <strong>Colors</strong>{' '}
        tab. These shape the sclera (the base eye shape) — iris/pupil are covered in <em>4. Pupil Controls</em>, eyelids in{' '}
        <em>5. Eyelid Controls</em>.
      </GuideP>

      <GuideControlRow name="Eye Width / Eye Height" range="20–130">The eye's own width and height — not circular by default, so these are independent.</GuideControlRow>
      <GuideControlRow name="Eye Radius" range="0–130">
        Corner rounding. At 0 you get a sharp rounded-rect corner; turned up high enough (past half the smaller of width/height)
        the eye becomes a full ellipse with no flat sides at all.
      </GuideControlRow>
      <GuideControlRow name="Eye Distance" range="0–160 px">
        The gap between the two eyes' centers — this is how far apart they sit, not a position for one eye alone. There's no
        independent X/Y position control for each eye; both eyes are always centered symmetrically around the display's middle,
        <code>Eye Distance</code> apart.
      </GuideControlRow>
      <GuideControlRow name="Eye Rotation" range="-45° to 45°">Tilts the whole eye shape. This is the eye's "tilt" — there's no separate tilt control.</GuideControlRow>

      <GuideH3>Color & border (Colors tab)</GuideH3>
      <GuideControlRow name="Sclera">The eye's base fill color (the equivalent of "eye fill color").</GuideControlRow>
      <GuideControlRow name="Border">The color of the ring drawn around the eye's edge.</GuideControlRow>
      <GuideControlRow name="Border Opacity" range="0–100%">
        How strongly the border color shows against the background — 0% makes the ring invisible, 100% is the pure border
        color.
      </GuideControlRow>
      <GuideControlRow name="Shadow Intensity / Glow Intensity" range="0–100%">A soft ambient shadow under the upper lid, and an outer glow behind the eye shape.</GuideControlRow>
      <GuideCallout tone="note">
        Border thickness is fixed (a constant 3px ring, matched exactly between the preview and the exported firmware) — there's
        no adjustable border-width slider, and there's no separate "eye opacity" control (the eye shape itself is always fully
        opaque; Border Opacity only affects the thin ring around it).
      </GuideCallout>

      <GuideH3>Left Eye, Right Eye, and Both Eyes</GuideH3>
      <GuideP>
        The <strong>Eye Target</strong> switch (top of Controls and Colors) has three positions:
      </GuideP>
      <GuideUl>
        <li><strong>Both Eyes</strong> — the normal mode. Edits apply to a single shared shape mirrored onto both eyes.</li>
        <li>
          <strong>Left Eye</strong> / <strong>Right Eye</strong> — edits from this point apply only to that eye, making it
          diverge from the shared shape. The other eye is untouched and keeps following "Both."
        </li>
      </GuideUl>
      <GuideCallout tone="warning">
        There's no "copy left to right" or "mirror" button — making an eye diverge is simply switching to Left or Right and
        editing a slider. To bring a diverged eye back in sync, switch to Both Eyes and adjust the shared shape again (this
        doesn't automatically clear the other eye's override, but a subsequent Both-Eyes edit updates the shared baseline both
        eyes fall back to whenever you're not actively diverging them).
      </GuideCallout>
      <GuideCallout tone="warning">
        Eye Target only affects the live pose you're designing (or a saved Expression). <strong>Animation keyframes always
        store one shared pose for both eyes</strong> — the Eye Target switch is disabled while a keyframe is selected, because
        an animation can't have the left and right eyes independently animated. If you need an asymmetric look (e.g. a wink),
        build it as a static Expression with Left/Right divergence rather than inside an animation's timeline.
      </GuideCallout>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 4. Pupil Controls
// ---------------------------------------------------------------------------------------

const pupilControls: GuideSection = {
  id: 'pupil-controls',
  title: 'Pupil Controls',
  content: (
    <>
      <GuideP>Found in the Controls tab's "Iris & Pupil" group. The iris and pupil are independent ellipses layered on top of the eye shape.</GuideP>

      <GuideControlRow name="Iris Width / Iris Height" range="10–100">Size of the iris, as a percentage of the eye's own half-width/half-height.</GuideControlRow>
      <GuideControlRow name="Pupil Width / Pupil Height" range="5–100">Size of the pupil, same percentage scale — independent width and height, so the pupil doesn't have to be a perfect circle.</GuideControlRow>
      <GuideControlRow name="Pupil X / Pupil Y" range="-100 to 100">
        Where the pupil (and iris) sit inside the eye — this is the "movement range" for looking around. ±100 reaches all the
        way to the eye's own edge in that direction.
      </GuideControlRow>
      <GuideControlRow name="Pupil Rotation" range="0°–360°">
        Spins the pupil ellipse around its own center, independent of the eye's rotation. Only visible when the pupil isn't a
        perfect circle (different width vs. height).
      </GuideControlRow>
      <GuideControlRow name="Iris / Pupil color">Set in the Colors tab, alongside the eye's other colors.</GuideControlRow>

      <GuideCallout tone="note">
        There's no separate "pupil shape" picker (it's always an ellipse, shaped by width/height) and no pupil opacity slider —
        the pupil is always fully opaque. The iris never rotates (only the pupil does), matching how a real iris pattern would
        look static while the pupil itself can be elongated and turned.
      </GuideCallout>

      <GuideH3>Staying inside the eye</GuideH3>
      <GuideP>
        The renderer clips the iris and pupil to the eye's own silhouette automatically — pushing Pupil X/Y to ±100 or beyond
        never actually draws outside the eye shape, on screen or in the exported firmware. You can push the sliders as far as
        they go without worrying about a pupil visibly escaping the eye.
      </GuideP>

      <GuideH3>Animating pupil movement</GuideH3>
      <GuideP>
        Looking in a direction is just a keyframe where Pupil X/Y is offset from center (0, 0). To animate a look: select a
        keyframe (or add a new one), set Pupil X/Y for the direction you want, and let the transition to/from neighboring
        keyframes handle the motion. See <em>7.10 Pupil Movement Animation</em> for full look-direction tutorials.
      </GuideP>

      <GuideH3>Independent left/right pupils</GuideH3>
      <GuideP>
        Same rule as Eye Controls: switch Eye Target to Left or Right before adjusting Pupil X/Y (or size) to make one eye look
        a different direction than the other — useful for a sideways glance or a wink. This only works for the live pose /
        Expressions, not inside animation keyframes (which are always shared between both eyes).
      </GuideP>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 5. Eyelid Controls
// ---------------------------------------------------------------------------------------

const eyelidControls: GuideSection = {
  id: 'eyelid-controls',
  title: 'Eyelid Controls',
  content: (
    <>
      <GuideP>
        Found in the Controls tab's "Eyelids" group. Upper and lower eyelids are fully independent — each is a soft-edged
        covering shape that slides in from the top or bottom of the eye.
      </GuideP>

      <GuideControlRow name="Upper Eyelid / Lower Eyelid" range="0–100">
        How far the lid covers the eye, from fully open (0) to fully closed (100). This is the "eyelid height" / how much of the
        eye is covered.
      </GuideControlRow>
      <GuideControlRow name="Upper Eyelid Tilt / Lower Eyelid Tilt" range="-45° to 45°">
        Tilts the lid's covering edge (a shear, not a rotation around the eye's center) — this is the eyelid "position/offset"
        control, giving each lid a natural angled edge instead of a flat horizontal line.
      </GuideControlRow>
      <GuideControlRow name="Upper Eyelid Curvature / Lower Eyelid Curvature" range="-100 to 100">
        How curved the lid's edge is. <strong>0 is flat/neutral.</strong> Negative values (down to -100) curve the lid{' '}
        <em>inward</em> — the center pulls back toward less coverage than the corners, an open, alert look. Positive values
        curve it <em>outward</em>, bulging further into the eye at the center than at the corners — a heavier, more
        relaxed/closing look.
      </GuideControlRow>

      <GuideCallout tone="tip">
        The curve is a smooth closed-form curve (mathematically a border-radius-style bump, similar in spirit to a Bézier
        curve): it always reaches the lid's flat sides with <em>zero slope</em>, at every curvature value in the full -100..100
        range — so there's no way to accidentally produce a sharp corner or jagged edge. The exact same formula is used in the
        exported firmware, so the preview and the real hardware always render an identical eyelid shape.
      </GuideCallout>

      <GuideH3>Independent left/right eyelids</GuideH3>
      <GuideP>
        Same Eye Target rule as the other controls: switch to Left or Right to give one eye a different eyelid shape than the
        other (for a wink, or an asymmetric squint). As with everything else, animation keyframes always keep both eyes' lids in
        sync — divergence is only for the live pose and Expressions.
      </GuideP>

      <GuideH3>Building common looks</GuideH3>
      <GuideTable
        headers={['Look', 'Roughly']}
        rows={[
          ['Blink (mid-blink)', 'Upper Eyelid ≈ 90–100, Lower Eyelid low, both curvature near 0'],
          ['Squint', 'Upper Eyelid ≈ 40–60, Lower Eyelid ≈ 15–25'],
          ['Sleepy', 'Upper Eyelid ≈ 60–75, slight negative curvature for a soft droop, slower transitions'],
          ['Angry', 'Upper Eyelid ≈ 20–35 with positive curvature (bulging down toward center), sharp/fast transitions'],
          ['Happy', 'Lower Eyelid raised (≈ 30–45) with positive curvature — a rounded "smiling" lower lid'],
          ['Surprised', 'Both eyelids near 0 (wide open), Eye Width/Height increased slightly']
        ]}
      />
      <GuideCallout tone="warning">
        Avoid stacking a very high Upper Eyelid value with a strongly negative curvature on the same lid — pulling the center
        back while already covering most of the eye can make the lid's peak sit outside the eye's own top edge, which visually
        reads as the lid vanishing at the center. If a lid looks "broken" at extreme values, back off the curvature magnitude
        first.
      </GuideCallout>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 6. Expressions
// ---------------------------------------------------------------------------------------

const expressions: GuideSection = {
  id: 'expressions',
  title: 'Expressions',
  content: (
    <>
      <GuideP>
        An <strong>Expression</strong> is a named, saved snapshot of a complete eye pose — every Eye/Pupil/Eyelid slider, every
        color, and any Left/Right divergence, all captured together under one name (e.g. "Happy"). Expressions live in the{' '}
        <strong>Expressions</strong> tab (left panel).
      </GuideP>
      <GuideP>
        Expressions and animations are related but different: an Expression is a reusable static look; an animation's keyframes
        are built the same way (same sliders) but exist to be played back over time. Applying an Expression is a fast way to
        load a known-good starting pose before adding a keyframe.
      </GuideP>

      <GuideH3>Working with expressions</GuideH3>
      <GuideUl>
        <li>
          <strong>Create</strong> — design a pose with the Controls/Colors panels, type a name into the Expressions panel's
          text field, and click <strong>Save Pose</strong>.
        </li>
        <li><strong>Switch / preview</strong> — click an expression in the list to load its pose live and see it on the preview canvas immediately.</li>
        <li>
          <strong>Edit and save changes back</strong> — with an expression selected, tweak any slider or color. The panel shows
          an <em>"Editing {'{name}'} — unsaved changes"</em> banner with a <strong>Save</strong> button; click it to write your
          edits back into that same expression. (Switching to a different expression while dirty asks for confirmation first, so
          you never lose changes silently.)
        </li>
        <li><strong>Rename</strong> — double-click the name in the list.</li>
        <li><strong>Delete</strong> — the ✕ button next to a row.</li>
      </GuideUl>
      <GuideCallout tone="note">
        There's currently no one-click Duplicate for expressions (unlike animations). To make a variant, apply the expression
        you want to start from, tweak it, then Save Pose under a new name instead of overwriting the original.
      </GuideCallout>
      <GuideCallout tone="note">
        There's no separate "default expression" setting distinct from the project's live base pose — whatever pose the project
        is in when you save it (design mode's current eyeBase/colors) is what a freshly opened project shows.
      </GuideCallout>

      <GuideH3>Suggested expressions to build</GuideH3>
      <GuideP>
        Kibo  Studio ships with 14 built-in expressions covering exactly this list already (Neutral, Happy, Sad, Focused,
        Angry, Surprised, Confused, Sleepy, Offline, Charging, Thinking, Notification, Meeting, Listening) — open any of them to
        see a worked example of how each look is built, then duplicate the approach for your own:
      </GuideP>
      <GuideUl>
        <li><strong>Neutral</strong> — resting defaults, no eyelid coverage, pupil centered.</li>
        <li><strong>Happy</strong> — lower eyelid raised with outward curvature (see Eyelid Controls table above).</li>
        <li><strong>Sad</strong> — eye height slightly reduced, upper eyelid partially lowered, pupil looking slightly down.</li>
        <li><strong>Angry</strong> — eye rotated, upper eyelid lowered with positive curvature, narrower iris/pupil.</li>
        <li><strong>Sleepy</strong> — upper eyelid mostly closed, reduced eye height, soft curvature.</li>
        <li><strong>Surprised</strong> — eye width/height increased, eyelids near 0, larger highlight.</li>
        <li>
          <strong>Blink / Look Left / Look Right / Look Up / Look Down</strong> — these are better suited as short{' '}
          <em>animations</em> than static expressions (a blink and a look both involve movement over time) — see{' '}
          <em>7.9 Blink Animation</em> and <em>7.10 Pupil Movement Animation</em>.
        </li>
      </GuideUl>

      <GuideCallout tone="tip">
        Every field on an expression — eye shape, pupil, both eyelids, every color, border settings, and any Left/Right
        divergence — is captured and restored together. Saving and reopening a project never drops part of an expression.
      </GuideCallout>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 7.x Animation Guide
// ---------------------------------------------------------------------------------------

const animOverview: GuideSection = {
  id: 'anim-overview',
  title: '7.1 Animation Overview',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        An <strong>animation</strong> is a named, ordered sequence of keyframes played back over time — e.g. "Blink" or "Look
        Left." It lives in the <strong>Animations</strong> tab (left panel) and is edited on the <strong>Timeline</strong>{' '}
        (bottom panel).
      </GuideP>

      <GuideH3>Timeline anatomy</GuideH3>
      <TimelineAnatomyDiagram />
      <GuideUl>
        <li>The horizontal track represents the whole animation's duration, start to end.</li>
        <li>Each diamond is a <strong>keyframe</strong> — a complete eye pose at one specific point in time.</li>
        <li>Each stretch of track between two keyframes is a <strong>segment</strong> (transition) — its length is that pair's duration, and it carries one easing curve.</li>
        <li>The vertical orange bar is the <strong>playhead</strong> — the animation's current playback position, shown live on the preview canvas.</li>
      </GuideUl>

      <GuideH3>Keyframe vs. expression vs. transition vs. clip vs. animation</GuideH3>
      <GuideTable
        headers={['Term', 'What it is']}
        rows={[
          ['Expression', 'A named, reusable static pose — not tied to any timeline.'],
          ['Keyframe', 'One pose plus a point in time, belonging to one specific animation.'],
          ['Transition / segment', 'The duration + easing between two consecutive keyframes — motion, not a pose.'],
          ['Clip', 'Not a distinct concept in Kibo  Studio — a full animation is the smallest playable unit.'],
          ['Animation', 'The whole ordered sequence of keyframes and their transitions, saved under one name.']
        ]}
      />

      <GuideH3>Playback position, FPS, and duration</GuideH3>
      <GuideP>
        The playhead's position is tracked in milliseconds, not frames — durations you type for each segment are also in
        milliseconds. An animation's total duration is simply the sum of every segment's duration. FPS doesn't change{' '}
        <em>how long</em> the animation is — it changes how often a frame gets drawn while playing it back (smoother at higher
        FPS, choppier at lower FPS, same wall-clock length either way). See <em>7.8 FPS and Timing</em> for the full
        explanation.
      </GuideP>

      <GuideTutorial title="A simple 5-keyframe example">
        <GuideP>Neutral → Look Left → Blink → Look Right → back to Neutral. As keyframes on one timeline, that's:</GuideP>
        <GuideOl>
          <li>Neutral pose, t = 0ms</li>
          <li>Pupil X shifted left (looking left), t = 400ms, eased in</li>
          <li>Eyelids fully closed (the blink), t = 550ms, fast ease in/out</li>
          <li>Pupil X shifted right (looking right), t = 950ms</li>
          <li>Back to Neutral pose, t = 1400ms</li>
        </GuideOl>
        <GuideP>Five keyframes, four transitions, one animation — this is exactly the pattern the tutorials in this Animation Guide build on.</GuideP>
      </GuideTutorial>
    </>
  )
}

const animCreating: GuideSection = {
  id: 'anim-creating',
  title: '7.2 Creating a New Animation',
  group: 'Animation Guide',
  content: (
    <GuideTutorial title="Build your first animation">
      <GuideOl>
        <li>Open the <strong>Animations</strong> tab (left panel).</li>
        <li>Click <strong>+ New</strong>. A new animation named "New Animation" appears with two keyframes already in place, and the app switches to Animate mode.</li>
        <li>Double-click its name in the list to rename it.</li>
        <li>
          FPS isn't set per-animation — it's the project-wide <strong>Display FPS</strong> slider (Display tab). Set it once for
          the whole project (see <em>7.8 FPS and Timing</em>).
        </li>
        <li>Duration isn't set up front either — it's the sum of your keyframes' segment durations, which you'll set as you add them (step 6 below).</li>
        <li>
          Toggle looping with the ↻ button in the Playback transport, or the loop toggle next to the animation's name in the
          Animations list — on for something that should repeat forever (Idle, Thinking), off for a one-shot (Blink, Wake Up).
        </li>
        <li>
          With the first keyframe selected, use the Controls/Colors panels to set its starting pose (often just the defaults, or
          an Expression's look — apply the expression first, then select the keyframe and it'll already match).
        </li>
        <li>
          Click <strong>+ Keyframe</strong> in the Timeline to add another one after the selected keyframe — it starts as a copy
          of the previous keyframe's pose, ready to adjust.
        </li>
        <li>Select the new keyframe and edit its Duration (ms) and Easing in the panel that appears below the timeline track.</li>
        <li>
          Switch to Animate mode's transport and press Play (or <KeyCombo mac={['Space']} winLinux={['Space']} />) to preview,
          then <KeyCombo mac={['⌘', 'S']} winLinux={['Ctrl', 'S']} /> to save the project.
        </li>
      </GuideOl>
    </GuideTutorial>
  )
}

const animTimelineControls: GuideSection = {
  id: 'anim-timeline-controls',
  title: '7.3 Timeline Controls',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>The Playback transport (top of the preview area) and the Timeline panel (bottom) together cover animation navigation:</GuideP>
      <GuideTable
        headers={['Control', 'What it does']}
        rows={[
          ['Play / Pause', 'Starts or pauses playback of the active animation from the current playhead position.'],
          ['Stop', 'Stops playback and resets the playhead to 0.'],
          ['Restart', 'Jumps to 0 and starts playing immediately.'],
          ['Previous Frame / Next Frame', 'Steps the playhead back/forward by one 30fps-equivalent frame step, pausing playback.'],
          ['Toggle Loop', 'Enables/disables looping for the active animation (same as the loop toggle in the Animations list).'],
          ['Playhead', 'The orange vertical marker on the Timeline track showing the current position.'],
          ['Timeline track', 'Click anywhere on it to jump (seek) the playhead directly to that point — this also switches to Animate mode.']
        ]}
      />
      <GuideCallout tone="note">
        There's no timeline zoom or horizontal-scroll control, no separate ruler with frame numbers, and no click-and-drag
        "jump to beginning/end" buttons beyond Stop (goes to 0) and Restart (goes to 0 and plays) — the track always fits the
        entire animation's duration into the available width. There's also no loop-range or selection-range concept: looping is
        always whole-animation (see <em>7.12 Looping</em>).
      </GuideCallout>
      <GuideP>
        <strong>Current time / current frame</strong> aren't shown as a persistent readout on the Timeline itself, but Developer
        Mode (<KeyCombo mac={['⌘', '.']} winLinux={['Ctrl', '.']} />) overlays live Frame # and Anim Time while something is
        playing.
      </GuideP>
    </>
  )
}

const animKeyframes: GuideSection = {
  id: 'anim-keyframes',
  title: '7.4 Working with Keyframes',
  group: 'Animation Guide',
  content: (
    <>
      <GuideUl>
        <li><strong>Add</strong> — <strong>+ Keyframe</strong> inserts a new one right after the selected keyframe (or at the end, if none is selected), copying the previous keyframe's pose as a starting point.</li>
        <li><strong>Select</strong> — click a keyframe's diamond marker on the track. This pauses playback, seeks the playhead to that keyframe's time, and switches Animate mode's Controls/Colors panels to edit that keyframe's pose.</li>
        <li>
          <strong>Move (retime)</strong> — drag a keyframe's diamond left/right along the track. This adjusts the duration of
          the segment <em>before</em> it in real time. The very first keyframe is pinned at t = 0 and can't be dragged — every
          animation always starts at the beginning.
        </li>
        <li><strong>Duplicate</strong> — the Duplicate button (or <KeyCombo mac={['⌘', 'D']} winLinux={['Ctrl', 'D']} />) inserts an exact copy immediately after the selected keyframe.</li>
        <li><strong>Delete</strong> — the Delete button (or <KeyCombo mac={['Delete']} winLinux={['Delete']} />). An animation always needs at least one keyframe, so the last one can't be deleted.</li>
        <li><strong>Change timing precisely</strong> — select the keyframe and type an exact value into the <strong>Duration (ms)</strong> field below the track, rather than dragging by eye.</li>
      </GuideUl>

      <GuideCallout tone="warning">
        <strong>Editing the eye while a keyframe is selected updates that keyframe</strong> — it does not change the whole
        animation or the project's shared base pose. The panel shows a banner ("Editing selected keyframe") whenever this is
        active, so you can always tell whether your next slider tweak is aimed at one keyframe or at the live base pose. Click
        elsewhere on the track (or Stop) to deselect and go back to editing the live pose.
      </GuideCallout>

      <GuideCallout tone="note">
        There's no multi-select (only one keyframe can be selected at a time) and no copy/paste between keyframes or animations
        — Duplicate is the closest equivalent, and it only works within the same animation. Because dragging a keyframe only
        ever changes the segment length on either side of it, keyframes can't be dragged past their neighbors, so overlapping
        keyframes at the same instant isn't something you can accidentally create.
      </GuideCallout>

      <GuideH3>How interpolation works</GuideH3>
      <GuideP>
        Every numeric value on a keyframe (widths, positions, colors, curvature — everything) is interpolated independently
        between the two keyframes bracketing the playhead, shaped by that segment's easing curve. Pupil Rotation specifically
        interpolates the "short way around" through 0°/360° rather than always spinning the long way. See{' '}
        <em>7.7 Transitions and Interpolation</em> for how each easing type shapes that blend.
      </GuideP>
    </>
  )
}

const animAddingExpressions: GuideSection = {
  id: 'anim-adding-expressions',
  title: '7.5 Reusing Expressions in an Animation',
  group: 'Animation Guide',
  content: (
    <>
      <GuideCallout tone="note">
        Kibo  Studio doesn't have drag-and-drop of an Expression directly onto the timeline — keyframes are always built with
        the Controls/Colors panels. The workflow below achieves the same result: starting a keyframe from a known, named look.
      </GuideCallout>
      <GuideOl>
        <li>Open the <strong>Expressions</strong> tab and click the expression you want to use as a starting point (e.g. "Happy"). This loads it into the live pose.</li>
        <li>Switch to the <strong>Animations</strong> tab and select the animation/keyframe you want that look applied to.</li>
        <li>
          Click <strong>+ Keyframe</strong> — the new keyframe is seeded from whatever the live pose currently is, so it starts
          out matching the expression you just applied. Adjust from there as needed.
        </li>
      </GuideOl>
      <GuideP>
        There's no "replace" shortcut either — to change an existing keyframe to match a different expression, select the
        keyframe, apply the expression (which updates the live pose), and the Controls panel will show you're editing that
        keyframe already, so the change lands on it directly.
      </GuideP>
      <GuideP>
        <strong>Repeating a look</strong> — using the same expression's pose more than once in one animation (e.g. a double
        blink returns to the open pose twice) just means adding more keyframes seeded the same way; there's no limit on reusing
        a look repeatedly.
      </GuideP>
      <GuideCallout tone="warning">
        Editing an Expression later does <em>not</em> retroactively update any keyframe you seeded from it — a keyframe's pose
        is copied at the moment you create it, not linked back to the expression. This is deliberate: it keeps existing
        animations stable even if you tweak an expression afterward.
      </GuideCallout>
    </>
  )
}

const animTracks: GuideSection = {
  id: 'anim-tracks',
  title: '7.6 How Animation Data Is Organized',
  group: 'Animation Guide',
  content: (
    <>
      <GuideCallout tone="note">
        Kibo  Studio doesn't split an animation into separate per-property tracks (no left-eye track, pupil track, color
        track, and so on, with individual expand/collapse/hide/lock/mute controls) — there's a single timeline per animation,
        and each keyframe is one complete pose covering every property at once.
      </GuideCallout>
      <GuideP>That has a few direct consequences worth knowing:</GuideP>
      <GuideUl>
        <li>
          <strong>You can't animate just one property while leaving others alone</strong> at the data level — but in practice
          this rarely matters, because a keyframe you duplicate or add already carries forward every other property's value
          unchanged, so adjusting only Pupil X on a new keyframe naturally leaves eye shape, colors, and eyelids exactly as they
          were.
        </li>
        <li>
          <strong>Animating "only one eye"</strong> isn't possible inside an animation — every keyframe always applies to both
          eyes together (see the warning in <em>Eye Controls</em> and <em>7.4</em>). A one-eyed effect like a wink has to be
          built as a static Expression instead, using Eye Target: Left/Right there.
        </li>
        <li>
          There's no track-level mute/lock — if you don't want a property to change between two keyframes, simply give it the
          same value on both; nothing will interpolate away from it.
        </li>
      </GuideUl>
    </>
  )
}

const animTransitions: GuideSection = {
  id: 'anim-transitions',
  title: '7.7 Transitions and Interpolation',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        A <strong>transition</strong> is a segment's duration plus its <strong>easing</strong> — the curve that shapes how
        quickly values change from the start keyframe to the end keyframe. Set both from the panel that appears below the
        Timeline when a keyframe is selected ("Duration (ms)" and "Easing (out to next keyframe)").
      </GuideP>

      <EasingCurvesDiagram />

      <GuideTable
        headers={['Easing', 'Feel']}
        rows={[
          ['Linear', 'Constant speed, mechanical — rarely looks natural for eyes.'],
          ['Ease In', 'Starts slow, accelerates — good for a movement building up.'],
          ['Ease Out', 'Starts fast, settles gently — the most natural default for most eye motion.'],
          ['Ease In Out', 'Slow-fast-slow — smooth, natural acceleration and deceleration, a solid all-purpose choice.'],
          ['Bounce', 'Overshoots and settles with a springy bounce — playful, exaggerated.'],
          ['Elastic', 'Overshoots further with an oscillating wobble — very energetic/springy.'],
          ['Custom Bezier', 'Four numeric x1/y1/x2/y2 control points (CSS cubic-bezier style) for a hand-tuned curve when none of the presets feel right.']
        ]}
      />
      <GuideCallout tone="note">
        There's no separate "Step / instant" easing preset — for an instant, snap-style change, set the segment's Duration to
        the smallest allowed value (16ms) instead; at that length the easing curve's shape barely matters.
      </GuideCallout>

      <GuideH3>Examples</GuideH3>
      <GuideTable
        headers={['Goal', 'Approach']}
        rows={[
          ['Fast blink with Ease In Out', 'Two short segments (~70–100ms each) closing then opening, both Ease In Out.'],
          ['Slow sleepy blink', 'Longer segments (400–700ms), Ease In Out or Ease Out, paired with a partial (not full) close.'],
          ['Sharp angry movement', 'Short duration (~90–120ms), Ease In or Linear for an abrupt, mechanical snap.'],
          ['Smooth natural eye movement', 'Ease In Out, medium duration (300–650ms) — this is what most of the built-in Look Left/Right/Up/Down animations use.'],
          ['Instant expression change', 'Minimum duration (16ms).'],
          ['Soft transition from Neutral to Happy', 'Longer duration (~600–900ms), Ease In Out, so the shift reads as a mood change rather than a snap reaction.']
        ]}
      />
    </>
  )
}

const animFpsTiming: GuideSection = {
  id: 'anim-fps-timing',
  title: '7.8 FPS and Timing',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        FPS (frames per second) is a single project-wide setting (Display tab, 1–120, default 30) — it is <em>not</em> set per
        animation.
      </GuideP>
      <GuideUl>
        <li><strong>What it controls:</strong> how often a frame is drawn/presented, both in the live preview and (via the exported <code>EYE_FRAME_DELAY_MS</code> constant) on the real ESP32.</li>
        <li>
          <strong>What it does NOT control:</strong> how long an animation takes to play. Keyframe durations are in
          milliseconds, wall-clock time — playback is time-based, not frame-counted, so changing FPS makes an animation smoother
          or choppier, never faster or slower.
        </li>
        <li>
          <strong>Relationship:</strong> at 30 FPS a frame is drawn roughly every 33ms; at 60 FPS, every 16ms. A 1000ms
          animation plays in one second either way — at 60 FPS you simply see about twice as many frames of it.
        </li>
      </GuideUl>
      <GuideCallout tone="tip">
        Because FPS and keyframe duration are independent, you can freely raise or lower FPS for smoothness/performance without
        it ever "unintentionally" changing an animation's timing — there's nothing to re-tune on your keyframes after an FPS
        change.
      </GuideCallout>

      <GuideTable
        headers={['FPS', 'Notes']}
        rows={[
          ['30', 'The default. Light processing load, smooth enough for the great majority of expressive eye animation.'],
          ['60', 'Noticeably smoother fast motion, but roughly double the draw calls per second — only use it once you\'ve confirmed the target ESP32 keeps up.'],
          ['15–24', 'Consider lowering if you\'re also driving other work on the same ESP32-C6 core and see stutter.'],
          ['>60', 'Only worth it if you\'ve actually measured the display + MCU sustaining it reliably — diminishing returns for eye animation specifically.']
        ]}
      />
      <GuideCallout tone="warning">
        Keep the Display FPS you export with the same as what you previewed at — the exported <code>EYE_FRAME_DELAY_MS</code>{' '}
        is derived directly from it, so a mismatched FPS between preview and export would only happen if you changed the
        setting <em>after</em> exporting and didn't re-export.
      </GuideCallout>
    </>
  )
}

const animBlink: GuideSection = {
  id: 'anim-blink',
  title: '7.9 Blink Animation',
  group: 'Animation Guide',
  content: (
    <>
      <GuideTutorial title="Build a reusable Blink animation">
        <GuideOl>
          <li>Create a new animation (see <em>7.2</em>) and name it "Blink."</li>
          <li>Keyframe 1 (t=0): Neutral pose — Upper/Lower Eyelid at 0.</li>
          <li>Add a keyframe. Set Upper Eyelid ≈ 40–50 (partially closed). Duration ≈ 60–80ms, Ease In.</li>
          <li>Add another keyframe. Set Upper Eyelid ≈ 95–100 (fully closed). Duration ≈ 40–60ms, Ease In.</li>
          <li>Add another keyframe, Upper Eyelid back to ≈ 40–50. Duration ≈ 40–60ms, Ease Out.</li>
          <li>Add a final keyframe back to Neutral (Upper Eyelid 0). Duration ≈ 60–80ms, Ease Out.</li>
          <li>Select each segment in turn and fine-tune easing — Ease In Out on the close/open pair usually reads most naturally.</li>
          <li>Play (<KeyCombo mac={['Space']} winLinux={['Space']} />) to preview the full blink.</li>
          <li>To change blink speed, scale all five segment durations up (slower) or down (faster) proportionally.</li>
          <li>Save the project — the animation is now reusable any time you play "Blink."</li>
        </GuideOl>
      </GuideTutorial>

      <GuideTable
        headers={['Variant', 'How']}
        rows={[
          ['Normal blink', 'The tutorial above — roughly 200–250ms total.'],
          ['Fast blink', 'Same shape, all durations scaled down to ~100–130ms total.'],
          ['Slow blink', 'Same shape, durations scaled up to 400ms+, Ease In Out throughout.'],
          ['Double blink', 'Two blinks back to back — repeat the close/open keyframe pattern twice before the final return to Neutral, with a short pause (a held Neutral-ish keyframe) between them.'],
          ['Sleepy blink', 'Slow blink, but don\'t fully return to 0 on the last keyframe — land around Upper Eyelid ≈ 15–25 for heavy-lidded eyes, and use a soft negative curvature.'],
          ['Wink (one eye only)', 'Animations can\'t diverge left/right (see 7.6) — build a wink as a static Expression instead: Eye Target → Left (or Right), close just that eye\'s lids, leave the other eye Neutral.']
        ]}
      />
    </>
  )
}

const animPupilMovement: GuideSection = {
  id: 'anim-pupil-movement',
  title: '7.10 Pupil Movement Animation',
  group: 'Animation Guide',
  content: (
    <>
      <GuideTutorial title="Look directions, step by step">
        <GuideOl>
          <li>Start from a Neutral keyframe (Pupil X = 0, Pupil Y = 0).</li>
          <li><strong>Look left:</strong> add a keyframe, set Pupil X to a negative value (e.g. -60), Ease In Out, ~300–500ms.</li>
          <li><strong>Look right:</strong> Pupil X positive (e.g. 60).</li>
          <li><strong>Look up:</strong> Pupil Y negative.</li>
          <li><strong>Look down:</strong> Pupil Y positive.</li>
          <li><strong>Return to center:</strong> add a keyframe with Pupil X/Y back to 0, similar duration/easing.</li>
        </GuideOl>
      </GuideTutorial>

      <GuideH3>Circular movement</GuideH3>
      <GuideP>
        Chain several look keyframes around the compass — e.g. up → right → down → left → back to up — each a similar duration
        apart, all with Ease In Out (or Linear, for a more mechanical scan). More intermediate keyframes (up, up-right, right,
        down-right, ...) make the circle read more smoothly, at the cost of a longer timeline to manage.
      </GuideP>

      <GuideH3>Natural micro-movements and pauses</GuideH3>
      <GuideP>
        Real eyes rarely sit perfectly still. Small, occasional Pupil X/Y nudges (a few percent, not a full look) between larger
        movements read as "alive" rather than mechanical. For pauses before changing direction, simply give a keyframe a longer
        Duration before the next one starts moving — the pose itself doesn't need a dedicated "hold" keyframe, since it already
        stays constant for however long that segment lasts.
      </GuideP>
      <GuideCallout tone="tip">
        For continuous idle-style micro-movement without hand-building it keyframe by keyframe, see the separate{' '}
        <strong>Personality</strong> panel and Idle mode — it procedurally drives blinks, gaze drift, and micro-movement from a
        handful of sliders, and is a good source of inspiration for natural timing even when hand-authoring an animation.
      </GuideCallout>

      <GuideH3>Staying inside the eye</GuideH3>
      <GuideP>
        As covered in <em>4. Pupil Controls</em>, the renderer always clips the pupil to the eye's silhouette — even at Pupil
        X/Y's extreme ±100, it can't visually escape the eye shape, in the preview or on real hardware.
      </GuideP>
    </>
  )
}

const animExpressionTransitions: GuideSection = {
  id: 'anim-expression-transitions',
  title: '7.11 Expression Transition Animation',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        An "expression transition" animation is just a two-(or-more)-keyframe animation where the start and end keyframes are
        seeded from two different Expressions (see <em>7.5</em>). What changes between them depends on the pair:
      </GuideP>
      <GuideTable
        headers={['Transition', 'Properties that typically change']}
        rows={[
          ['Neutral → Happy', 'Lower eyelid raised + curved outward; maybe a slightly wider eye.'],
          ['Happy → Neutral', 'The reverse of the above.'],
          ['Neutral → Angry', 'Eye rotation, upper eyelid lowered with positive curvature, narrower iris/pupil, faster easing.'],
          ['Neutral → Surprised', 'Eye width/height increased, eyelids toward 0, larger highlight, quick Ease Out.'],
          ['Awake → Sleepy', 'Upper eyelid raised toward 60–75, eye height reduced, slow Ease In Out.'],
          ['Open eyes → Closed eyes', 'Both eyelids toward 100 — essentially the closing half of a blink, held rather than reopened.']
        ]}
      />
      <GuideP>
        Use a longer duration and gentler easing (Ease In Out) for mood shifts that should read as gradual, and a shorter,
        sharper duration for reactive changes (surprise, sudden anger).
      </GuideP>
    </>
  )
}

const animLooping: GuideSection = {
  id: 'anim-looping',
  title: '7.12 Looping',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        Looping is a single per-animation on/off setting — the ↻ toggle in the Playback transport, or next to an animation's
        name in the Animations list (animations currently set to loop show a ↻ suffix there). There's no partial/selected-range
        looping — it's always the entire animation, start to end.
      </GuideP>
      <GuideH3>Seamless loops</GuideH3>
      <GuideUl>
        <li>Make the last keyframe's pose match the first keyframe's pose exactly (copy values across, or duplicate the first keyframe and move the copy to the end).</li>
        <li>Give the final segment (last keyframe back to first) a reasonable duration and easing rather than an instant snap, unless you specifically want a hard cut.</li>
        <li>Preview with looping on and watch several cycles in a row — a jump that's invisible on one pass is often obvious by the third or fourth loop.</li>
      </GuideUl>
      <GuideCallout tone="warning">
        If the last and first keyframes don't match, looped playback will show a visible jump at the seam every cycle — this is
        the most common cause of a loop that "pops" or "jumps at the end."
      </GuideCallout>
      <GuideP>
        The loop setting is exported along with everything else (see <em>7.16</em>) — <code>Anim_&lt;Name&gt;_loop</code> in the
        generated C++, read by <code>eyesPlayAnimation()</code> to decide whether to wrap back to the start or stop after the
        last segment.
      </GuideP>
    </>
  )
}

const animPreview: GuideSection = {
  id: 'anim-preview',
  title: '7.13 Animation Playback Preview',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        Preview lives in <strong>Animate mode</strong> (one of the three mode tabs above the preview canvas: Design / Animate /
        Idle). The transport controls (see <em>7.3</em>) are only enabled in this mode.
      </GuideP>
      <GuideUl>
        <li><strong>Start/stop</strong> — Play/Pause and Stop in the transport, or <KeyCombo mac={['Space']} winLinux={['Space']} /> to toggle play/pause.</li>
        <li><strong>At the selected FPS</strong> — preview always plays at the project's Display FPS setting, matching what real hardware will show (see <em>7.8</em>).</li>
        <li><strong>Once vs. looped</strong> — controlled by the animation's own Loop toggle (see <em>7.12</em>) — there's no separate "preview once" override independent of that setting.</li>
        <li><strong>Frame-by-frame</strong> — Previous Frame / Next Frame (or ← / → keys) step one frame at a time with playback paused, useful for inspecting a specific transition closely.</li>
        <li><strong>Selected-range preview</strong> — not available; playback always covers the full animation.</li>
      </GuideUl>
      <GuideCallout tone="note">
        There's no built-in side-by-side speed-comparison view — to compare speeds, temporarily scale a copy's segment
        durations (Duplicate the animation first via the Animations panel) and play each back in turn.
      </GuideCallout>
      <GuideCallout tone="tip">
        Stuttering in the live preview is almost always a sign your machine's frame rate is dropping below the project's FPS
        setting under load, not a problem with the animation data itself — Developer Mode's live FPS readout (
        <KeyCombo mac={['⌘', '.']} winLinux={['Ctrl', '.']} />) helps confirm whether that's what's happening.
      </GuideCallout>
      <GuideCallout tone="warning">
        The preview renders with the exact same interpolation/easing math the exported C++ uses (<code>eyesLerpFrame</code> and
        the same easing formulas, ported line-for-line) — what you see in Animate mode is what the real ESP32 will show, not an
        approximation of it.
      </GuideCallout>
    </>
  )
}

const animSaving: GuideSection = {
  id: 'anim-saving',
  title: '7.14 Saving Animations',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        Save and Save As (see <em>2. Getting Started</em>) write the <em>entire</em> project, and that includes every animation
        in full:
      </GuideP>
      <GuideUl>
        <li>Every animation and its name, every keyframe and its full pose, every segment's duration and easing (including custom bezier control points).</li>
        <li>The loop setting per animation.</li>
        <li>Which animation and mode (Design/Animate/Idle) you had open, which Eye Target was selected, and which expression (if any) was active — reopening the file restores the editor to this same state, not just the raw project data.</li>
        <li>Every expression, all display/color settings, and anything generated via Reference Image import (since that always lands as ordinary expression/eyeBase data — there's no separate "imported asset" the save file needs to track apart from that).</li>
      </GuideUl>
      <GuideCallout tone="note">
        There's no track visibility/lock state to preserve (see <em>7.6</em> — there are no tracks), and no left/right{' '}
        <em>animation</em> divergence to preserve, since keyframes are always shared between both eyes by design.
      </GuideCallout>
      <GuideP>
        Reopening later (File → Open Project) puts you back in the same animation, at the same playhead, with the same eye
        target and mode — ready to keep editing immediately, exactly as <em>2. Getting Started</em> describes.
      </GuideP>
    </>
  )
}

const animManaging: GuideSection = {
  id: 'anim-managing',
  title: '7.15 Duplicating and Managing Animations',
  group: 'Animation Guide',
  content: (
    <>
      <GuideUl>
        <li><strong>Rename</strong> — double-click an animation's name in the Animations list.</li>
        <li><strong>Duplicate</strong> — the ⧉ button (appears on hover) makes a full copy, named "&lt;name&gt; Copy," with every keyframe cloned.</li>
        <li><strong>Delete</strong> — the ✕ button (appears on hover). A project must keep at least one animation, so the last one can't be deleted.</li>
      </GuideUl>
      <GuideCallout tone="note">
        Reordering the animation list, setting a "default startup animation," grouping animations into folders/categories, and
        reusable cross-project presets aren't currently supported — the list is a flat, unordered-by-you collection (new items
        append to the end), and there's no concept of one animation being the project's "default." <strong>Duplicate</strong> is
        the closest tool for a reusable starting point today: build a base animation, duplicate it, and adjust the copy.
      </GuideCallout>
      <GuideP>
        <strong>Copying between projects</strong> — use Export → Animation JSON (exports just the currently-active animation) on
        the source project, then Export dialog's <strong>Import JSON...</strong> button on the destination project to bring it
        in. See <em>7.16</em> and <em>8. Export</em>.
      </GuideP>
    </>
  )
}

const animExporting: GuideSection = {
  id: 'anim-exporting',
  title: '7.16 Exporting Animations',
  group: 'Animation Guide',
  content: (
    <>
      <GuideP>
        The C++ Header export (Export dialog → "C++ Header" tab) turns every animation and expression into plain data structs
        in one self-contained header file — no separate library or runtime needed beyond it.
      </GuideP>

      <GuideH3>How it's stored</GuideH3>
      <GuideUl>
        <li>Each animation becomes a <code>const EyeFrame Anim_&lt;Name&gt;[] PROGMEM</code> array (one struct per keyframe, field order documented in the header's own top comment) plus <code>Anim_&lt;Name&gt;_count</code> and <code>Anim_&lt;Name&gt;_loop</code>.</li>
        <li>Each expression becomes one <code>const EyeFrame Expr_&lt;Name&gt; PROGMEM</code> constant (or two, <code>_L</code>/<code>_R</code>, if it has left/right divergence).</li>
        <li>
          <strong>Timing</strong> is stored per-keyframe in milliseconds (a <code>durationMs</code> field), not frame counts —
          interpolation happens against real elapsed time (<code>millis()</code>), so playback speed doesn't depend on how
          often <code>loop()</code> happens to run.
        </li>
        <li>FPS becomes two <code>#define</code>s: <code>EYE_TARGET_FPS</code> and <code>EYE_FRAME_DELAY_MS</code> (how long to <code>delay()</code> per frame to hit that rate) — used only to pace drawing, not to affect the time-based interpolation above.</li>
        <li>Easing (including custom bezier control points) is baked in as an enum value + four bezier bytes per keyframe, evaluated by the same curve math the editor's preview uses.</li>
        <li>
          Left/right eyes are drawn with one function, <code>eyesDrawEyePair()</code>, from a single interpolated pose (
          <code>LiveEye</code>) — it draws the left eye normally and the right eye mirrored, using two separate color palettes
          (<code>EYE_COLORS_LEFT</code>/<code>EYE_COLORS_RIGHT</code>) so per-eye color divergence still renders correctly even
          though pose data itself is shared.
        </li>
      </GuideUl>

      <GuideH3>Using it in an ESP32 sketch</GuideH3>
      <GuideOl>
        <li>Save the exported header as <code>eyes.h</code> next to your sketch's <code>.ino</code> file.</li>
        <li><code>#include &lt;Adafruit_GC9A01A.h&gt;</code> (before including <code>eyes.h</code>) and <code>#include "eyes.h"</code> in your sketch.</li>
        <li>Create the display object and call its <code>begin()</code> once in <code>setup()</code>.</li>
        <li>Call <code>eyesPlayAnimation()</code> once per <code>loop()</code> with whichever <code>Anim_&lt;Name&gt;</code> you want playing, then draw and present the result.</li>
      </GuideOl>

      <GuideCallout tone="note">
        Kibo  Studio's exported API is symbol-based, not string-based — there's no <code>EyesPlayAnimation("Blink")</code>{' '}
        that looks an animation up by name at runtime. Each animation/expression is its own C++ symbol (<code>Anim_Blink</code>,{' '}
        <code>Expr_Happy</code>, ...) that you reference directly in your own code, and there's no separate "stop" function —
        you simply stop calling <code>eyesPlayAnimation()</code> for that animation (e.g. switch to drawing a static expression
        instead, or freeze on the last frame). The actual generated names below are exactly what a real export produces.
      </GuideCallout>

      <GuideCode>{`#include <SPI.h>
#include <Adafruit_GC9A01A.h>
#include "eyes.h"

EyesBufferedDisplay tft(TFT_CS, TFT_DC, TFT_RST);
unsigned long animStart = 0;
uint16_t frameIndex = 0;

void setup() {
  tft.begin();
  animStart = millis();
}

void loop() {
  LiveEye live;
  // Play the "Blink" animation (Anim_Blink / _count / _loop are all generated for you):
  eyesPlayAnimation(Anim_Blink, Anim_Blink_count, Anim_Blink_loop, animStart, frameIndex, live);

  tft.fillScreen(EYE_COLOR_BACKGROUND);
  eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);
  tft.present();
  delay(EYE_FRAME_DELAY_MS);
}

// Switching to a different animation: call eyesPlayAnimation() with a different
// Anim_<Name> the next time you want it to start, resetting the timer first:
//   animStart = millis(); frameIndex = 0;
//   eyesPlayAnimation(Anim_Happy, Anim_Happy_count, Anim_Happy_loop, animStart, frameIndex, live);

// Showing a static expression instead of an animation (e.g. "restart"/"pause" on one pose):
//   LiveEye live = eyesLerpFrame(Expr_Neutral, Expr_Neutral, 0);
//   eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);
`}</GuideCode>
      <GuideP>
        A ready-to-flash demo <code>setup()</code>/<code>loop()</code> that cycles the idle animation and every expression is
        also bundled in every export, opt-in via <code>#define EYES_ENABLE_DEMO</code> before including the header — see the
        comment block at the top of any exported file for the exact steps.
      </GuideP>
    </>
  )
}

const animOptimization: GuideSection = {
  id: 'anim-optimization',
  title: '7.17 ESP32 Animation Optimization',
  group: 'Animation Guide',
  content: (
    <GuideUl>
      <li><strong>Choose an appropriate FPS</strong> — 30 is a good default; only go higher once you've measured the real board sustaining it (see <em>7.8</em>).</li>
      <li><strong>Reduce unnecessary keyframes</strong> — each keyframe costs flash (its struct is baked into <code>PROGMEM</code>); a smooth motion usually needs far fewer keyframes than you'd think, since interpolation fills in every value in between.</li>
      <li><strong>Reuse expressions</strong> as starting points for keyframes instead of hand-tuning every pose from scratch — keeps your library consistent and saves design time (doesn't reduce flash usage directly, since keyframe data is still copied in, but reduces the risk of subtly inconsistent poses).</li>
      <li><strong>Avoid overly complex effects</strong> — extreme highlight sizes, glow, or shadow intensity add draw cost per frame; keep them reasonable if you're also targeting high FPS.</li>
      <li><strong>Reduce memory usage</strong> — Developer Mode's Est. Flash Usage / Est. RAM Usage readout gives a running estimate as you build out animations, so you can catch a bloated project before exporting.</li>
      <li><strong>Avoid large embedded assets</strong> — there are none in this pipeline by design; everything is procedural (numbers), not images, so there's no bitmap/video bloat to worry about.</li>
      <li><strong>Interpolation, not stored frames</strong> — the export only ever stores your keyframes, never every intermediate frame; the ESP32 computes each frame's pose live from <code>eyesLerpFrame()</code>, which is cheap.</li>
      <li><strong>Test on the real 240×240 display</strong> — the preview is faithful, but only real hardware confirms actual achieved frame rate and any panel-specific quirks.</li>
      <li><strong>Monitor frame rate/performance</strong> — track <code>millis()</code> between frames in your own sketch if you suspect drops; Kibo  Studio's export doesn't include built-in FPS instrumentation on-device.</li>
      <li><strong>Avoid blocking delays</strong> — the generated example uses a single small <code>delay(EYE_FRAME_DELAY_MS)</code> per loop; if you add your own logic (sensors, networking) in the same <code>loop()</code>, keep it non-blocking so it doesn't stall animation timing.</li>
    </GuideUl>
  )
}

const animTroubleshooting: GuideSection = {
  id: 'anim-troubleshooting',
  title: '7.18 Animation Troubleshooting',
  group: 'Animation Guide',
  content: (
    <GuideTable
      headers={['Problem', 'Likely cause / fix']}
      rows={[
        ['Animation does not play', "You're not in Animate mode — the transport is disabled in Design/Idle mode. Switch mode tabs first."],
        ['Timeline appears empty', 'No animation is selected — pick one from the Animations list first; a brand-new project always ships with 19 built-in animations already present.'],
        ['Keyframes are not saved', "Keyframe edits are part of the project like everything else — make sure you're actually saving the project (Ctrl/Cmd+S) after editing, not just closing the app or an unrelated dialog."],
        ['Expression changes are lost', "Editing an expression only takes effect once you click that panel's Save button (the 'unsaved changes' banner) — switching away without saving discards the edit (with a confirmation prompt first)."],
        ['Animation speed is incorrect', 'Check individual segment durations, not FPS — FPS never changes animation speed, only smoothness (see 7.8).'],
        ['Preview and exported animation look different', "Shouldn't happen — preview and export share the same interpolation/easing math. If you do see a difference, confirm you re-exported after your latest edits and re-flashed the newest header."],
        ['Blink does not fully close', 'Upper/Lower Eyelid needs to reach 100 at the closed keyframe, not just a high value like 80-90.'],
        ['Pupils move outside the eye', "This shouldn't be visually possible — the renderer clips the pupil to the eye's silhouette in both preview and export. If something looks wrong, double-check Pupil X/Y are within -100..100 (out-of-range values get clamped on export)."],
        ['Left and right eye animations overwrite each other', "Animation keyframes can't diverge left/right by design (see 7.6) — there's nothing to overwrite because both eyes always share one pose per keyframe. For an asymmetric look, build a static Expression with Eye Target: Left/Right instead."],
        ['Animation stutters on ESP32', 'Usually a sign of a blocking delay or heavy work elsewhere in loop() — see 7.17\'s note on avoiding blocking delays, and confirm your chosen FPS is realistic for everything else the sketch is doing.'],
        ['Loop jumps at the end', "The last keyframe's pose doesn't match the first — see 7.12's seamless-loop guidance."],
        ['Negative eyelid curvature is not restored', 'This is fully supported — curvature values from -100 to 100 round-trip correctly through Save/Open and export. If an older project file predates the negative-curvature range, its stored value is preserved as-is on reopen (no reset to 0).'],
        ['FPS is not included in the exported code', "It always is — check the header's #define EYE_TARGET_FPS / EYE_FRAME_DELAY_MS near the top."],
        ['Saved projects reopen without animation data', "Shouldn't happen with a valid .kiboeyes file. If you opened an unrelated or corrupted file, Kibo  Studio shows a clear error instead of silently loading an empty project — if you saw an empty project instead of an error, please report it as a bug."]
      ]}
    />
  )
}

// ---------------------------------------------------------------------------------------
// 8. Export
// ---------------------------------------------------------------------------------------

const exportSection: GuideSection = {
  id: 'export',
  title: 'Export',
  content: (
    <>
      <GuideP>
        Open the Export dialog from the toolbar's <strong>Export...</strong> button, File → Export, or{' '}
        <KeyCombo mac={['⌘', 'E']} winLinux={['Ctrl', 'E']} />. It has three tabs:
      </GuideP>
      <GuideTable
        headers={['Tab', 'Produces', 'Typical filename']}
        rows={[
          ['C++ Header', 'The full self-contained firmware header — every animation, expression, and the drawing/playback code itself.', <code key="a">ProjectName_eyes.h</code>],
          ['Animation JSON', 'Just the currently-active animation, as portable JSON (for moving one animation into another project — see 7.15).', <code key="b">AnimationName.json</code>],
          ['Project JSON', 'The same JSON your .kiboeyes save file contains — mainly useful for inspecting/diffing project data outside the app.', <code key="c">ProjectName.json</code>]
        ]}
      />
      <GuideP>
        Click <strong>Save to File...</strong> to write the currently-shown tab's content via a native save dialog. There's no
        separate "target ESP32 display size" selector in the Export dialog — the display size/shape is a Display tab setting
        that's already baked into every exported frame.
      </GuideP>

      <GuideH3>Getting it into your ESP32 project</GuideH3>
      <GuideOl>
        <li>Save the C++ Header export as <code>eyes.h</code> in your Arduino sketch folder (or PlatformIO <code>include/</code> or <code>src/</code>, depending on your project layout).</li>
        <li>In your <code>.ino</code>/<code>.cpp</code>: <code>#include &lt;Adafruit_GC9A01A.h&gt;</code>, then <code>#include "eyes.h"</code>.</li>
        <li>Construct an <code>EyesBufferedDisplay</code> with your panel's CS/DC/RST pins, and call <code>.begin()</code> once in <code>setup()</code>.</li>
        <li>In <code>loop()</code>, call <code>eyesPlayAnimation()</code> (or <code>eyesLerpFrame()</code> for a static expression), then <code>eyesDrawEyePair()</code>, then <code>.present()</code>. See the full example in <em>7.16 Exporting Animations</em>.</li>
      </GuideOl>
      <GuideCallout tone="tip">
        Every exported header includes a detailed usage comment at the top (field order, an opt-in demo <code>setup()</code>/
        <code>loop()</code>, and notes on buffered vs. direct drawing) — it's worth reading once even after you've done this a
        few times, since it documents exactly what that specific export contains.
      </GuideCallout>
      <GuideP>
        <strong>Visual consistency:</strong> the exported drawing code (<code>eyesDrawEye</code>, <code>eyesFillEyelid</code>,
        interpolation, and easing) is the same math the editor's preview uses — there is deliberately no separate,
        approximated "export renderer." What you see in the app is what ships to the display.
      </GuideP>
    </>
  )
}

// ---------------------------------------------------------------------------------------
// 9. Tips and Best Practices
// ---------------------------------------------------------------------------------------

const tips: GuideSection = {
  id: 'tips',
  title: 'Tips and Best Practices',
  content: (
    <GuideUl>
      <li><strong>Natural-looking eyes:</strong> avoid perfectly round, perfectly centered, perfectly still defaults for long — even small asymmetries and movement read as more alive.</li>
      <li><strong>Believable blinking:</strong> a blink is rarely symmetric in timing — closing slightly faster than opening (Ease In on the close, Ease Out on the open) reads more natural than a perfectly mirrored pair.</li>
      <li><strong>Small pupil movements:</strong> full ±100 Pupil X/Y swings read as a deliberate "look" — for idle life, keep incidental movement much smaller (a few percent).</li>
      <li><strong>Pauses matter:</strong> a beat of stillness before and after a movement sells it far better than constant motion — use segment duration itself as the "hold," no separate pause keyframe needed.</li>
      <li><strong>Avoid constant movement:</strong> eyes that never stop moving read as anxious or robotic rather than expressive — let animations finish and rest.</li>
      <li><strong>Expressive but readable:</strong> push 2-3 properties clearly (e.g. eyelid position + pupil size) rather than changing everything a little — a clear silhouette reads faster than a subtle one.</li>
      <li><strong>Smooth motion:</strong> prefer Ease In Out or Ease Out over Linear for most eye movement — see 7.7's curve comparisons.</li>
      <li><strong>Seamless idle loops:</strong> match first/last keyframes exactly (7.12), and preview several loop cycles in a row before calling it done.</li>
      <li><strong>Test on real hardware:</strong> colors, timing, and perceived smoothness can all look different on the actual GC9A01 panel versus the desktop preview's monitor — always confirm on-device before finalizing.</li>
      <li><strong>Balance smoothness vs. performance:</strong> higher FPS and more keyframes both cost more; only spend that budget where it's visually earning its keep (see 7.17).</li>
    </GuideUl>
  )
}

// ---------------------------------------------------------------------------------------
// 10. Keyboard Shortcuts
// ---------------------------------------------------------------------------------------

const shortcuts: GuideSection = {
  id: 'shortcuts',
  title: 'Keyboard Shortcuts',
  content: (
    <>
      <GuideTable
        headers={['Action', 'Windows / Linux', 'macOS']}
        rows={[
          ['New Project', <KeyCap key="a">Ctrl+N</KeyCap>, <KeyCap key="b">⌘N</KeyCap>],
          ['Open Project', <KeyCap key="a">Ctrl+O</KeyCap>, <KeyCap key="b">⌘O</KeyCap>],
          ['Save', <KeyCap key="a">Ctrl+S</KeyCap>, <KeyCap key="b">⌘S</KeyCap>],
          ['Save As', <KeyCap key="a">Ctrl+Shift+S</KeyCap>, <KeyCap key="b">⌘⇧S</KeyCap>],
          ['Undo', <KeyCap key="a">Ctrl+Z</KeyCap>, <KeyCap key="b">⌘Z</KeyCap>],
          ['Redo', <><KeyCap key="a">Ctrl+Shift+Z</KeyCap> or <KeyCap key="a2">Ctrl+Y</KeyCap></>, <KeyCap key="b">⌘⇧Z</KeyCap>],
          ['Duplicate Keyframe', <KeyCap key="a">Ctrl+D</KeyCap>, <KeyCap key="b">⌘D</KeyCap>],
          ['Delete Keyframe', <KeyCap key="a">Delete / Backspace</KeyCap>, <KeyCap key="b">Delete / Backspace</KeyCap>],
          ['Add Keyframe', 'Toolbar "+ Keyframe" button only — no shortcut yet', 'Toolbar "+ Keyframe" button only — no shortcut yet'],
          ['Play / Pause Animation', <KeyCap key="a">Space</KeyCap>, <KeyCap key="b">Space</KeyCap>],
          ['Stop Animation', 'Playback menu only (accelerator currently shared with Toggle Developer Mode below)', 'Playback menu only'],
          ['Previous Frame', <KeyCap key="a">←</KeyCap>, <KeyCap key="b">←</KeyCap>],
          ['Next Frame', <KeyCap key="a">→</KeyCap>, <KeyCap key="b">→</KeyCap>],
          ['Jump to Beginning', 'Use Stop (resets playhead to 0) — no dedicated shortcut', 'Use Stop — no dedicated shortcut'],
          ['Jump to End', 'Not currently available', 'Not currently available'],
          ['Zoom Timeline In / Out', 'Not currently available — the timeline always fits the full animation', 'Not currently available'],
          ['Toggle Looping', 'Transport ↻ button only — no shortcut yet', 'Transport ↻ button only — no shortcut yet'],
          ['Export dialog', <KeyCap key="a">Ctrl+E</KeyCap>, <KeyCap key="b">⌘E</KeyCap>],
          ['Toggle Developer Mode', <KeyCap key="a">Ctrl+.</KeyCap>, <KeyCap key="b">⌘.</KeyCap>],
          ['Open User Guide', <KeyCap key="a">F1</KeyCap>, <KeyCap key="b">F1</KeyCap>]
        ]}
      />
      <GuideCallout tone="note">
        Copy/Paste don't apply to anything in Kibo  Studio today (there's no copy/paste for keyframes — Duplicate is the
        closest equivalent, see 7.4), so they're intentionally left off this list rather than bound to something misleading.
        Shortcuts are inactive while typing in a text field (project name, expression name, numeric inputs, etc.) so normal
        text editing always works as expected.
      </GuideCallout>
    </>
  )
}

export const GUIDE_SECTIONS: GuideSection[] = [
  welcome,
  gettingStarted,
  eyeControls,
  pupilControls,
  eyelidControls,
  expressions,
  animOverview,
  animCreating,
  animTimelineControls,
  animKeyframes,
  animAddingExpressions,
  animTracks,
  animTransitions,
  animFpsTiming,
  animBlink,
  animPupilMovement,
  animExpressionTransitions,
  animLooping,
  animPreview,
  animSaving,
  animManaging,
  animExporting,
  animOptimization,
  animTroubleshooting,
  exportSection,
  tips,
  shortcuts
]

/** Extra searchable terms per section beyond its title — lets the guide's search bar find a
 * topic like "curvature" or "easing" even though that word isn't in any section heading,
 * without needing to extract plain text out of each section's JSX content at runtime. */
export const GUIDE_SEARCH_KEYWORDS: Record<string, string> = {
  welcome: 'introduction overview what is kibo studio workflow',
  'getting-started': 'new project open save save as fps resolution display background export code difference autosave',
  'eye-controls': 'width height radius distance rotation border color opacity sclera eye target left right both mirror copy symmetry',
  'pupil-controls': 'iris pupil size position rotation color movement range look direction shape',
  'eyelid-controls': 'upper lower eyelid tilt curvature bezier blink squint sleepy angry happy surprised offset',
  expressions: 'create rename save duplicate delete apply preview neutral happy sad angry sleepy surprised blink look default',
  'anim-overview': 'keyframe transition clip timeline playhead fps duration what is an animation',
  'anim-creating': 'new animation tutorial loop fps duration step by step',
  'anim-timeline-controls': 'play pause stop restart previous next frame playhead zoom scroll ruler duration',
  'anim-keyframes': 'add select move duplicate delete copy paste interpolation retime overlap multi select',
  'anim-adding-expressions': 'drag insert playhead replace repeat convert reuse expression keyframe',
  'anim-tracks': 'track left right eye pupil eyelid color border lock mute hide expand collapse',
  'anim-transitions': 'easing linear ease in out bounce elastic bezier step instant interpolation personality',
  'anim-fps-timing': 'fps frames seconds duration performance smooth 30 60',
  'anim-blink': 'blink fast slow double sleepy wink close eyelid',
  'anim-pupil-movement': 'look left right up down center circular micro movement pause direction',
  'anim-expression-transitions': 'neutral happy angry surprised sleepy awake closed transition mood',
  'anim-looping': 'loop seamless jump range enable disable',
  'anim-preview': 'preview play stutter skipped frame fps compare speed',
  'anim-saving': 'save animation keyframes fps loop reopen state',
  'anim-managing': 'rename duplicate delete reorder default startup preset group',
  'anim-exporting': 'export arduino cpp code function call play stop pause restart eyesplayanimation header struct',
  'anim-optimization': 'optimize memory flash ram performance esp32 keyframes',
  'anim-troubleshooting': 'troubleshoot problem bug fix not working stutter jump lost missing',
  export: 'export arduino cpp header json filename esp32 platformio display size',
  tips: 'tips best practices natural blinking pause smooth idle',
  shortcuts: 'keyboard shortcuts keys ctrl cmd hotkeys'
}
