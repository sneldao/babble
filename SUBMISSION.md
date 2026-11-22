# Babble — submission drafts

## X post (required)

Project Name: Babble
Team Members: @<your-handle>
Project Description: Babble is an interspecies interpreter: point a mic at your cat or dog, browser DSP measures the actual vocalization (pitch contour, call segmentation, spectral centroid), and an OpenClaw agent on Kimi K3.1 Pro @ Cerebras says what it meant, citing the measurements behind each read. Once it starts answering, the whole translation lands in a fraction of a second. Talk back and it re-synthesizes your words as meows; it remembers each pet between sessions. Race it against the same model on GPUs.
GitHub Repository: https://github.com/sneldao/babble
Hosted demo (recorded answers): https://sneldao.github.io/babble/
Demo Video: (attach 60s)

#KimiOnCerebras @Cerebras @Kimi_Moonshot

## Reddit (r/cerebras, flair "Kimi K3.1 Pro Hackathon")

Title: Babble — a real-time interpreter for your cat, running Kimi K3.1 Pro on Cerebras

Body: Point your mic at your cat (or dog, or baby). The browser does real
DSP on the vocalization — f0 contour, call segmentation, envelope, spectral
centroid — and sends it to an OpenClaw agent backed by Kimi K3.1 Pro on
Cerebras. The agent classifies the call, shows the evidence it used ("rising
contour; 2 calls; median f0 600 Hz") and speaks for the animal. Reply in the
chat box and it vocalizes your message back as synthetic meows/barks via
WebAudio; the animal hears you in the same OpenClaw session, and the agent
keeps notes on each pet for next time. Flip on race to watch the same model
decode on Cerebras and on GPUs side by side.

Repo: https://github.com/sneldao/babble
Hosted demo (plays the recorded real responses): https://sneldao.github.io/babble/

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
