# Brain-dump prompts

Hand this to the human and let them talk freely against it. This is the *input* scaffold — it feeds the human-readable top of the issue. The agent fills the implementation half by reading the code.

**Tell them:** Ramble. Speech-to-text is fine. Don't worry about order, structure, grammar, or transcription errors — just react to the prompts and say what you're thinking. Skip any that don't apply. You can answer in one stream; I'll read it and ask follow-ups only where something's missing.

---

**Why does this matter?**
What's broken, missing, or annoying without it? Who feels the pain, and when? What goes wrong today?

**When it works, walk me through it.**
Describe the end state as if it already exists. What does someone see or experience? What's the moment that tells you "yes, this is working"?

**How does someone interact with it?**
The concrete handles — e.g. how do you turn it on, how do you block someone, how do you edit it, what happens when you get it wrong? Talk through the interactions, not the implementation.

**How would you know it's done?**
What would you check to be satisfied? What are the must-pass cases? Any edge cases that would embarrass us if missed?

**What is this explicitly NOT?**
What's tempting to fold in but should stay out of scope? Where's the line?

**(Optional) Anything you already know about the code?**
A file, a tricky bit, a past attempt, a gotcha you remember. Just a seed — I'll investigate from here. Don't feel obligated; this half is my job.

**(Targeting) Where does this go?**
Which repo should it be filed in, and is there a parent issue or epic it belongs under?
