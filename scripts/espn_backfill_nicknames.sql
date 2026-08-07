-- Nickname/variant espn_id backfill (run in Supabase SQL editor as owner).
-- Each link is NAME + HEIGHT corroborated (last season 2025-26). 7 same-surname
-- different-people were rejected by the height check (e.g. two 'Marcus Jackson').

UPDATE players SET espn_id=5108721 WHERE id=50268;  -- Uginus Jarusevicius / Arizona  (roster "Uginus Jarusevicius" = stats "Ugnius Jarusevicius")
UPDATE players SET espn_id=5060732 WHERE id=50668;  -- Billy Richmond / Arkansas  (roster "Billy Richmond" = stats "Billy Richmond III")
UPDATE players SET espn_id=5060709 WHERE id=50245;  -- Robert Wright / BYU  (roster "Robert Wright" = stats "Robert Wright III")
UPDATE players SET espn_id=5107876 WHERE id=50541;  -- Jalen Jackson / Butler
UPDATE players SET espn_id=5176171 WHERE id=50545;  -- Christian Moore / Butler
UPDATE players SET espn_id=5101664 WHERE id=49936;  -- Norjus Indrusaitis / California  (roster "Norjus Indrusaitis" = stats "Nojus Indrusaitis")
UPDATE players SET espn_id=5105401 WHERE id=50406;  -- MJ Collins / Cincinnati  (roster "MJ Collins" = stats "MJ Collins Jr.")
UPDATE players SET espn_id=5242115 WHERE id=50349;  -- Amir Jones / Colorado  (roster "Amir Jones" = stats "Asim Jones")
UPDATE players SET espn_id=5175029 WHERE id=53052;  -- Malik Davis / Davidson  (roster "Malik Davis" = stats "Malachi Davis")
UPDATE players SET espn_id=5239526 WHERE id=53016;  -- Ameal L'etang / Dayton  (roster "Ameal L'etang" = stats "Amaël L'Etang")
UPDATE players SET espn_id=5240520 WHERE id=50558;  -- Theo Pierre-Justin / DePaul  (roster "Theo Pierre-Justin" = stats "Théo Pierre-Justin")
UPDATE players SET espn_id=5312300 WHERE id=50559;  -- Fabian Flores / DePaul  (roster "Fabian Flores" = stats "Fabián Flores")
UPDATE players SET espn_id=5314723 WHERE id=49778;  -- Cameron Williams / Duke
UPDATE players SET espn_id=4873209 WHERE id=49777;  -- Patrick Ngongba / Duke  (roster "Patrick Ngongba" = stats "Patrick Ngongba II")
UPDATE players SET espn_id=5176227 WHERE id=49865;  -- Amare Robinson / Florida State  (roster "Amare Robinson" = stats "Amire Robinson")
UPDATE players SET espn_id=5314644 WHERE id=49866;  -- JD Jones / Florida State  (roster "JD Jones" = stats "Jay Jones")
UPDATE players SET espn_id=5226072 WHERE id=53089;  -- Kevin Odih / Fordham  (roster "Kevin Odih" = stats "Kelvin Odih")
UPDATE players SET espn_id=5241326 WHERE id=52941;  -- Bradley Henige / Fresno State  (roster "Bradley Henige" = stats "Bradey Henige")
UPDATE players SET espn_id=5060706 WHERE id=50307;  -- Trent Perry / Kansas
UPDATE players SET espn_id=5108983 WHERE id=50361;  -- Jaylen Alexander / Kansas State  (roster "Jaylen Alexander" = stats "Jaden Alexander")
UPDATE players SET espn_id=5152658 WHERE id=50360;  -- Papa N'Diaye / Kansas State  (roster "Papa N'Diaye" = stats "Pape N'Diaye")
UPDATE players SET espn_id=4685664 WHERE id=50585;  -- Justin McBride / Kentucky
UPDATE players SET espn_id=5101849 WHERE id=50584;  -- Malchi Moreno / Kentucky  (roster "Malchi Moreno" = stats "Malachi Moreno")
UPDATE players SET espn_id=5254317 WHERE id=53160;  -- Devin Booker / La Salle
UPDATE players SET espn_id=5061583 WHERE id=53141;  -- Malik Diallo / Loyola Chicago  (roster "Malik Diallo" = stats "Malick Diallo")
UPDATE players SET espn_id=5248300 WHERE id=50456;  -- Michael Phillips / Marquette  (roster "Michael Phillips" = stats "Michael Phillips II")
UPDATE players SET espn_id=5240005 WHERE id=50163;  -- Maban Jabriel / Maryland
UPDATE players SET espn_id=4683777 WHERE id=50152;  -- DJ Wagner / Maryland  (roster "DJ Wagner" = stats "D.J. Wagner")
UPDATE players SET espn_id=5240885 WHERE id=53172;  -- Maxime Logue / Memphis  (roster "Maxime Logue" = stats "Maxim Logue")
UPDATE players SET espn_id=5177139 WHERE id=53173;  -- Richards Vavers / Memphis  (roster "Richards Vavers" = stats "Rihards Vavers")
UPDATE players SET espn_id=5214641 WHERE id=49764;  -- LJ Cason / Miami  (roster "LJ Cason" = stats "L.J. Cason")
UPDATE players SET espn_id=5238203 WHERE id=49763;  -- Somoto Cyril / Miami  (roster "Somoto Cyril" = stats "Somtochukwu Cyril")
UPDATE players SET espn_id=5105758 WHERE id=50687;  -- Jordan Crawford / Missouri
UPDATE players SET espn_id=4873151 WHERE id=49904;  -- Paul McNeil / NC-State  (roster "Paul McNeil" = stats "Paul McNeil Jr.")
UPDATE players SET espn_id=4683941 WHERE id=49914;  -- RJ Keene / NC-State  (roster "RJ Keene" = stats "RJ Keene II")
UPDATE players SET espn_id=4937074 WHERE id=49915;  -- Darroin Williams / NC-State  (roster "Darroin Williams" = stats "Darrion Williams")
UPDATE players SET espn_id=5311849 WHERE id=49793;  -- Devin Brown / Notre Dame
UPDATE players SET espn_id=5037872 WHERE id=50122;  -- Curtis Givens / Ohio State  (roster "Curtis Givens" = stats "Curtis Givens III")
UPDATE players SET espn_id=5313093 WHERE id=50714;  -- Christian Brown / Ole Miss
UPDATE players SET espn_id=5186456 WHERE id=50017;  -- Dywane Aristode / Oregon  (roster "Dywane Aristode" = stats "Dwayne Aristode")
UPDATE players SET espn_id=5175011 WHERE id=52966;  -- Josiah Lake / Oregon State  (roster "Josiah Lake" = stats "Josiah Lake II")
UPDATE players SET espn_id=5143304 WHERE id=52973;  -- Xavier Staton / Oregon State  (roster "Xavier Staton" = stats "Xavion Staton")
UPDATE players SET espn_id=5105801 WHERE id=50192;  -- Dasante Bowen / Penn State  (roster "Dasante Bowen" = stats "Dasonte Bowen")
UPDATE players SET espn_id=5314477 WHERE id=53116;  -- Amon Dorries / Richmond  (roster "Amon Dorries" = stats "Amon Dörries")
UPDATE players SET espn_id=5105402 WHERE id=50208;  -- Darren Buchanan / Rutgers  (roster "Darren Buchanan" = stats "Darren Buchanan Jr.")
UPDATE players SET espn_id=4685647 WHERE id=49830;  -- Jaylin Stewart / SMU
UPDATE players SET espn_id=5243364 WHERE id=52882;  -- Nick Anderson / San Diego State
UPDATE players SET espn_id=5313924 WHERE id=52878;  -- Elize Harrington / San Diego State  (roster "Elize Harrington" = stats "Elzie Harrington")
UPDATE players SET espn_id=4685685 WHERE id=50505;  -- Devin Williams / Seton Hall
UPDATE players SET espn_id=4684164 WHERE id=53189;  -- Mike James / South Florida
UPDATE players SET espn_id=4898230 WHERE id=53186;  -- Garrett Johnson / South Florida
UPDATE players SET espn_id=5106235 WHERE id=50487;  -- Avery Brown / St. John's
UPDATE players SET espn_id=5331892 WHERE id=49957;  -- Calvin Russell / Syracuse  (roster "Calvin Russell" = stats "Calvin Russell III")
UPDATE players SET espn_id=5176754 WHERE id=49949;  -- Luke Wilson / Syracuse
UPDATE players SET espn_id=5037876 WHERE id=50380;  -- Micah Robinson / TCU
UPDATE players SET espn_id=5242126 WHERE id=50748;  -- Braeden Lue / Tennessee  (roster "Braeden Lue" = stats "Braedan Lue")
UPDATE players SET espn_id=5254159 WHERE id=50637;  -- Isaiah Johnson / Texas
UPDATE players SET espn_id=5313358 WHERE id=52948;  -- DJ Hall / Texas State
UPDATE players SET espn_id=5313360 WHERE id=52949;  -- Robert Fields / Texas State
UPDATE players SET espn_id=5313361 WHERE id=52950;  -- Dimp Pernell / Texas State
UPDATE players SET espn_id=5313359 WHERE id=52951;  -- Ky Pernell / Texas State
UPDATE players SET espn_id=5174981 WHERE id=50095;  -- Brandon Williams / UCLA
UPDATE players SET espn_id=4610012 WHERE id=50092;  -- Eric Dailey / UCLA  (roster "Eric Dailey" = stats "Eric Dailey Jr.")
UPDATE players SET espn_id=5311500 WHERE id=50447;  -- Emir Dzafic / UConn  (roster "Emir Dzafic" = stats "Elmir Džafic")
UPDATE players SET espn_id=5177734 WHERE id=50077;  -- Joshua Hughes / USC
UPDATE players SET espn_id=5174952 WHERE id=50070;  -- KJ Lewis / USC
UPDATE players SET espn_id=4873146 WHERE id=50074;  -- Jadis Jones / USC
UPDATE players SET espn_id=5060724 WHERE id=52922;  -- AJ Bates Jr. / Utah State  (roster "AJ Bates Jr." = stats "AJ Bates")
UPDATE players SET espn_id=5095154 WHERE id=50610;  -- Sebsastian Williams-Adams / Vanderbilt  (roster "Sebsastian Williams-Adams" = stats "Sebastian Williams-Adams")
UPDATE players SET espn_id=5144166 WHERE id=50614;  -- TO Barrett / Vanderbilt  (roster "TO Barrett" = stats "T.O. Barrett")
UPDATE players SET espn_id=4869737 WHERE id=50180;  -- Wesley Yates / Washington  (roster "Wesley Yates" = stats "Wesley Yates III")
UPDATE players SET espn_id=5175042 WHERE id=52956;  -- RJ Jones / Washington State
UPDATE players SET espn_id=5107878 WHERE id=52961;  -- Casey Jones / Washington State  (roster "Casey Jones" = stats "C.J. Jones")
UPDATE players SET espn_id=5311530 WHERE id=50570;  -- Ruben Dominguez / Xavier  (roster "Ruben Dominguez" = stats "Rubén Dominguez")
