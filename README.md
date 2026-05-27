# 🗿 TDW Editor
When thirty dollars just isn't enough  
[(shut up and let me use it already)](https://swordmaster3214.github.io/TDW-Editor)
## What is this?
This is a custom editor that I made for the [Thirty Dollar Website](https://thirtydollar.website). The OG editor has some limitations that I built this in order to help work around. Some features include:
### A custom built UI
A fancy searchable sidebar instead of the plain old box, a brand new look, and a multi-track editor.
### Support for multiple tracks???
Yep. You can create as many renameable tracks as you want and they will all play simultaneously, no matter the rhythm, and you can export it directly to TDW's native format without any hassle with the clicking and dragging and combine nonsense.
### you can export it to the main website too omg
Uh, yeah. My code handles the combine and speed nonsense for you. That way you can focus on making your tunes sound just right without spamming too many control blocks.
### And what was that you said about rhythm?
You can configure each individual sound to play any way you'd like. Quarter notes, half notes, eighth notes, sixteenth notes, triplets, quintuplets, whatever. Never have to do math to get a nice rhythm again.
## What isn't this?
A replacement. Please, keep using the original TDW. This is just a tool that makes some things about making TDW remixes a bit easier. The core logic remains mostly the same.
## K. Some more detail ples
Alrighty. Here goes:
### How exactly does this improve upon the original TDW?
* Sidebar. You can now scroll through a categorized list of sounds. You can search for a specific sound using keywords such as the title, the type, or the origin.
* Multi-track sequencing. You are no longer bound to a single track of sounds, you can separate them however you would like, and we'll play it back the way you'd expect.
* Solo and Mute buttons. This comes with the multi-track features. In original TDW, it can get pretty difficult to drag and drop a sound all the way to where you need it to be should it be removed or altered. Oh yeah,
* Cursor. My mouse is broken so OG TDW is almost unusable for me (skill issue). The click and drag model just doesn't work with a mouse that can't handle it. So now you have a cursor and can adjust, delete, and insert sounds wherever you want.
* Saving, importer, and exporter. This project uses it's own `.tde` format, too, so you can pick up where you left off at any time. You can import anything from OG TDW as well, and your input will be processed accordingly. If you are happy with what you have made, you can export to a `.🗿` file
and play it in the thirty dollar website.
### What stays the same?
There are many things that will seem familiar to those who have been making thirty dollar remixes for a while. I've retained a variety of shortcuts for editing the qualities of sounds, like arrow keys, ctrl, shift, etc.
### Why?
Just because I felt like it. I was making my own thirty dollar remix and discovered that I am going to have to do the tedious task of combining many differently pitched bups with a portion of the song that I have already written and I'm all like "nah, too lazy and tired, ima make a tool to
do it easier" and I did.
### I want to run this locally!!!
You can do just that by having Node.js installed and running
```
node server.mjs
```
and you can just type `http://localhost:3000` into your browser and there you have it.
### Is this it?
Eh, I'm sure there's something that I probably missed, but it's whatever. You'll figure it out.
