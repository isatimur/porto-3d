# Real-device checklist

The bench runs on one Apple M1 Max. It can slow the CPU and the network down. It cannot reproduce a phone GPU, thermal throttling, or the memory limits of iOS Safari. Please test these on real devices and send the numbers back.

## Which devices

| Device | Why |
| --- | --- |
| iPhone 12 or older (4 GB), Safari | iOS kills a tab near 1 to 1.5 GB; the Apple GPU string is hidden ("Apple GPU") |
| iPhone 15 or newer, Safari, Low Power Mode on and off | 30 Hz cadence detection |
| Android flagship (Adreno 7xx or Mali-G7xx), Chrome | the Medium class on a fast GPU |
| Android budget phone, 2 to 3 GB (Mali-G52, Adreno 6xx), Chrome | the Low class, memory pressure |
| A 5-year-old laptop with Intel UHD or HD graphics | iGPU fill rate |
| A desktop or laptop with a 120 Hz or 144 Hz display | the 60 fps cap below Ultra |
| Any machine with hardware acceleration switched off in the browser | the Potato class (software GL) |

## What to look at

1. Open `https://porto-3d.vercel.app/?perf=1` (or press Shift+P on a keyboard).
2. Wait for the city to settle. Fly to the overview, then to the Ribeira, then start the Cinema for 30 seconds.
3. Read the overlay:
   - `fps`, `ms`, `p95`: p95 is the number that matters. Under about 20 ms is smooth at 60 Hz; under 36 ms is fine on a phone.
   - `class`: the class the device got and why (`score`). If it looks wrong, note the GPU line at the bottom.
   - `pressure`: how far the governor had to cut (0 is the class as designed, 28 is the maximum). A device that sits above 12 for long is a candidate for a lower default class.
   - `gpu ... MB`: bytes the page asked the GPU for. Compare with the budget printed beside it.
   - `js heap`: Chrome only.
   - `long tasks`: main-thread stalls over 50 ms in the last 10 seconds.
4. Try the menu: Menu, Image, Quality. Switch between Auto, Ultra, High, Medium, Low, Potato. Medium, Low and Potato switch live; Ultra to High is live too; crossing between High and Medium reloads the page.
5. Rotate the phone, switch tabs for 30 seconds and come back, lock and unlock the screen. The scene must come back without a reload (or reload cleanly).
6. Offline: after one visit, switch on airplane mode and reload. The page must open.

## Send the numbers back

Press **Export JSON** in the overlay. The file `porto-perf-<date>.json` holds the device caps and GPU name, the class and why, every governor change with its time, frame statistics, a one-second series (fps, p95, triangles, draw calls, GPU MB, JS heap), long tasks, load marks and errors. Attach it to the issue, or paste its content.

## What the bench cannot tell you

- Whether the class table matches real GPUs: the table is educated, the GPU names in it are not measured on those chips.
- Thermal behaviour: the governor can demote a class after a sustained slowdown, but we have only simulated the load schedule.
- Whether iOS keeps the tab alive: measured JS heap is 190 MB and GPU allocation about 310 MB on the phone profiles; the browser's own limits are not visible from here.
- Real touch gestures under load, and battery drain.
