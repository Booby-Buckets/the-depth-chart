#!/usr/bin/env python3
"""Pull the numeric training labels from the players table → players_labeled.pkl"""
import os
import requests, pandas as pd
from pathlib import Path

SB="https://izlqhnxowdhtdofkwrho.supabase.co"
KEY=os.environ["SUPABASE_SERVICE_KEY"]  # export before running
H={"apikey":KEY,"Authorization":f"Bearer {KEY}"}
DATA=Path(__file__).parent/"data"

COLS=("name,team,position,position2,class_year,yr,height,ppg,rpg,apg,mpg,"
      "fgm,fga,fg_pct,tpm,tpa,tp_pct,ftm,fta,ft_pct,oreb,dreb,stl,blk,tovs,gp,tdc_grade")

r=requests.get(f"{SB}/rest/v1/players?select={COLS}&tdc_grade=not.is.null&limit=5000",
               headers=H,timeout=60)
r.raise_for_status()
df=pd.DataFrame(r.json())
df["grade_num"]=pd.to_numeric(df.tdc_grade,errors="coerce")
df.to_pickle(DATA/"players_labeled.pkl")
print("labeled rows:",len(df),"| numeric grades:",df.grade_num.notna().sum(),
      "| with mpg:",df[df.mpg.notna()&df.grade_num.notna()].shape[0])
print(df.grade_num.describe())
