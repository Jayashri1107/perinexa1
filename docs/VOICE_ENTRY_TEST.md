# Voice entry – test in Google Chrome, and decisions for the doctor

## Part 1 – 10 sentences to read aloud

These sentences are made up. They contain no real patient, so nothing private is recorded or kept.

### Before you start
- Use the clinic computer, in Google Chrome, with a headset microphone if you have one.
- Open Perinexa, go to **New patient**, and choose **Pregnancy (antenatal)** as the type of care.
- (Optional, added 2 Oct 2026) The same works for **Abortion (pregnancy loss)**: "LMP …" fills the loss's LMP, and
  "missed miscarriage", "ectopic" or "molar pregnancy" fill the type of loss. Anything about the baby's sex is taken
  out, as in antenatal care.
- Read each sentence at your normal speed and in your normal way of speaking. Please do not slow down or speak more carefully than usual, because the test needs to hear how you really dictate.
- For each sentence:
  1. Press **Start recording**.
  2. Read the sentence once.
  3. Press **Stop**.
  4. Copy the words shown in the text box and paste them into your message to us, with the sentence number.
  5. Write down what the form filled in, and any question it asked.
  6. Clear the text box before the next sentence.

### Sentences about Indian English pronunciation

**1. "Three", "thirty" and "thyroid"** (many speakers say "th" as "t")
> Gravida three, para two, living two, abortion zero. Known case of hypothyroid on Thyronorm fifty.

It should fill: gravida 3, para 2, living 2, abortions 0, and tick Thyroid.

**2. Short forms said letter by letter, and "weeks"**
> Previous L S C S five years back, now twenty eight weeks.

It should fill: previous caesareans 1. It may add a message asking for the LMP, because the weeks alone cannot be used.

**3. The letter H said as "aitch" or "haitch" (Rh)**
> Blood group O, R H negative. Anti D given at twenty eight weeks.

It should ask you to confirm "Blood group O negative", and add "Anti-D given" to the notes.

**4. Phone number said in Indian style, with "double" and "zero"**
> Mobile nine eight four five zero, double seven, eight one two.

It should fill the mobile number 98450 77812.

**5. Height said as "one fifty two"**
> Height one fifty two, weight fifty eight kilo.

It should fill: height 152 cm and weight 58 kg. It must never fill 100 cm.

**6. Hindi words mixed with English**
> Naam Kavita Sample, pachees saal, pehli pregnancy.

It should fill: name Kavita Sample, age 25, and first pregnancy (gravida 1, para 0, living 0, abortions 0, previous caesareans 0).

### Sentences about safety rules

**7. Test results that are negative**
> HIV non-reactive, HBsAg non-reactive, VDRL non-reactive.

Nothing should be ticked. If any of these is ticked, tell us straight away.

**8. A result that is positive** (made-up, for the test only)
> HBsAg reactive.

Hepatitis B must not be ticked by itself. The app should ask you to confirm first, with the choices "Yes, reactive", "No, non-reactive" and "Leave blank".

**9. Correcting yourself while speaking**
> Age twenty six, sorry, twenty seven.

It should fill age 27 and show that the age was corrected while speaking (26 to 27).

**10. A date that is only approximate**
> L M P two months back.

It should not fill the LMP by itself. It should ask you to confirm the date it worked out.

### One more check: switching tabs
1. Press **Start recording** and say "Gravida two, para one".
2. Switch to another Chrome tab for about 10 seconds, then come back.
3. Tell us what the screen shows: does it say **Paused**, or is it still recording?

This helps with decision 6 below.

## Part 2 – decisions for the doctor (answered 29 Sep 2026)

| # | Question | Owner's answer | Built |
|---|---|---|---|
| 1 | "BP" said as an illness ("known case of BP", "BP patient", "on BP tablets") | Tick high blood pressure automatically | Yes. BP readings ("120 by 80"), "BP normal", "no BP", low BP, BP in a previous pregnancy or in this pregnancy, and a family member's BP are handled as before |
| 2 | "Previous operation", "operation delivery", "cut delivery" | Ask | Yes (asks "previous caesarean?") |
| 3 | Positive test results | Confirm with one tap | Yes |
| 4 | "No DM HTN thyroid" said without pauses | As built | Yes |
| 5 | "Last date", "last MC", "periods came on" mean the LMP | Keep | Yes |
| 6 | Switching to another tab while recording | Keep recording | Yes. If Chrome stops listening while you are in the other tab, the card says so when you come back |
| 7 | Correcting yourself ("sorry", "matlab") | Use the later value and show the change | Yes |
| 8 | 30-minute automatic logout while dictating | Speech counts as activity | Yes |
| 9 | Blood group and Rh heard by voice | One tap on "Yes, correct" | Yes |
| 10 | 5 minutes per recording | Keep: the text is kept and Start continues | Yes |

## Results of the owner's test in Google Chrome (29 Sep 2026)

| # | What Chrome wrote | Before | Now |
|---|---|---|---|
| 1 | Gravida 3 para 2 living to abortion zero known case of hypothyroid on Thyronorm 50 | Correct | Correct |
| 2 | Previous LSCS five years back now 28 weeks | "5 years back now 28 weeks" not understood | Previous caesareans 1, note "Previous LSCS 5 years back", and "LMP about 17 Mar 2026 (said: now 28 weeks) – is that right?" |
| 3 | Blood group Rh negative NTD given at 28 weeks | Chrome wrote "NTD" for "anti D"; nothing filled | "NTD" before "given / injection / dose" is read as anti-D (shown with Undo); note "Anti-D given at 28 weeks"; asks "Which ABO group?" because Chrome dropped the "O". A real "NTD" (neural tube defect) is left alone |
| 4 | Mobile 98450 double seven eight one two | Correct | Correct |
| 5 | Height 152 weight 58 kilo | Correct | Correct |
| 6 | Pregnancy | Chrome's English model wrote none of the Hindi words | Common Hindi words (naam, saal, pehli, pachees …) are now suggested to Chrome, and the tips say to repeat a missed Hindi word in English. Words Chrome does not write cannot be recovered |
| 7 | Hiv non-reactive hbs AG non-reactive vdrl non-reactive | Nothing recorded | Note "HIV non-reactive, HBsAg non-reactive, VDRL non-reactive"; nothing ticked |
| 8 | Hbs AG reactive | Asked to confirm | Asked to confirm |
| 9 | Age 26 sorry 27 | Age 27 | Age 27 |
| 10 | LMP two months back | Asked | Asked |

These 10 transcripts are now permanent automatic tests (`client/src/pages/patients/testdata/voiceOwnerChrome.json`).

Please use made-up details only. Real patient details must not be entered until an experienced developer has
reviewed the app.
