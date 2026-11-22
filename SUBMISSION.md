# Babble — submission drafts

## X post (required, the official entry)

Deadline: Sunday 22 Nov, 10:00 AM PT (18:00 UTC). Attach the video (60 s or
less, recorded with standard OpenClaw, not the speed patch). Impressions are
counted Tuesday 24 Nov, 10:00 AM PT; organic only.

### Standard account (275 characters; X counts the link as 23)

```
Project Name: Babble
Team: @ungethe
Project Description: It translates your pet: measures the real meow or bark, then an OpenClaw agent on Kimi K3.1 Pro on Cerebras says what it meant.
GitHub: https://github.com/sneldao/babble
Demo Video: below
#KimiOnCerebras @Cerebras @Kimi_Moonshot
```

### First reply under it (270 characters)

```
Try it: https://sneldao.github.io/babble/ (hosted demo, plays recorded real answers)

How it works: browser DSP measures pitch, call count and loudness. An OpenClaw agent on Kimi K3.1 Pro on Cerebras reads the numbers plus a frame of your video. Talk back and it meows your words.
```

### Long form (X Premium only)

Project Name: Babble
Team Members: @ungethe
Project Description: Babble is an interspecies interpreter: point a mic at your cat or dog (or drop in a video of them), browser DSP measures the actual vocalization (pitch contour, call segmentation, spectral centroid), and an OpenClaw agent on Kimi K3.1 Pro @ Cerebras says what it meant, citing the measurements behind each read. Once it starts answering, the whole translation lands in about a second or less. Talk back and it re-synthesizes your words as meows; it remembers each pet between sessions. Race it against the same model on GPUs.
GitHub Repository: https://github.com/sneldao/babble
Hosted demo (recorded answers): https://sneldao.github.io/babble/
Demo Video: (attached)

#KimiOnCerebras @Cerebras @Kimi_Moonshot

## Reddit (optional; r/cerebras, flair "Kimi K3.1 Pro Hackathon"; same deadline; upload the video or link YouTube)

Saved as a draft on Reddit (r/Cerebras → Create → Drafts) with the flair set.
Add the video with the editor's video button, or paste a YouTube link.

Title: Babble: a translator for your cat or dog, running Kimi K3.1 Pro on Cerebras through OpenClaw

Body:

Babble translates your pet. Point a mic at your cat or dog, or drop in a video of them, and it tells you what they meant.

How it works:

- The browser measures the actual sound: pitch contour, number of calls, loudness, spectral centroid. You watch it being drawn as the clip plays.
- Those measurements, plus a frame from the loudest moment of the video, go to an OpenClaw agent running Kimi K3.1 Pro on Cerebras.
- The agent classifies the call, shows the evidence it used (for example "2 prolonged calls; falling contour; crouched posture at the loudest moment") and speaks for the animal.
- Type a reply and it voices your words back as synthetic meows or barks. The animal answers in the same OpenClaw session, and the agent keeps notes on each pet for next time.

A video of Charlie the cat on a shed roof came back as: "I'm stuck up here and I don't like it. Stop filming and help me down."

On speed: the app shows queue wait and decode time separately. In most of our live runs the whole translation streamed in under a second once Kimi K3.1 Pro started answering on Cerebras; the wait in the shared trial queue before that is the slow part. There is also a mode that runs the same model on a GPU provider side by side.

Try it: https://sneldao.github.io/babble/ (hosted demo; the samples play recorded real answers, and your own uploads are measured and drawn, but live translation needs the local build)

Repo: https://github.com/sneldao/babble

Built for the Cerebras x Kimi K3.1 Pro x OpenClaw weekend hackathon.

## Speed bounty (Discord #share-your-demo)

Speed Bounty entry: 1,032 TPS (server-side p90; 572 mean on the same run)

Products found by the patched OpenClaw run (session
`main/9192d345640b442eb9353af35f791131` on the patched gateway, :19001):

1. Waterstones — The Boy, the Mole, the Fox and the Horse
   https://www.waterstones.com/book/the-boy-the-mole-the-fox-and-the-horse/charlie-mackesy/9781529105100
2. Hotel Chocolat — Mini Chocolate Christmas Crackers (10)
   https://www.hotelchocolat.com/uk/p/mini-chocolate-christmas-crackers/300835m.html
3. Lush — Snow Fairy Gift Set
   https://www.lush.com/uk/en/p/snow-fairy-gift
4. Whittard — Coffees of the World Gift Set, £27.96
   https://www.whittard.com/products/coffees-of-the-world-gift-set
5. LEGO — Orchid 10311
   https://www.lego.com/en-gb/product/orchid-10311

Video: screen-record the session page (chat + all 5 product tabs + the
"572 tok/s mean · 1,032 p90 (server)" readout) and post to
#share-your-demo with the line above.
