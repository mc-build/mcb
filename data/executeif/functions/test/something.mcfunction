scoreboard players set #ifelse int 0
execute if score a b = 2 run function executeif:test/zzz/0
execute if score #ifelse int matches 0 if score a b = 3 run run function executeif:test/zzz/1
execute if score #ifelse int matches 0 run function executeif:test/zzz/2