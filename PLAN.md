# XHS and Weibo Monthly Scraper

I want to create a JS script that fetches me all the links on the current webpage that follow the criteria.

## Given
- An account webpage of Xiaohongshu or Weibo that is scrolled far enough that the links are on the page.
- Start and end date, but by default it will be the current calendar month (UTC+8). Also accept a whole
  month directly like `{ month: '2026-07' }`, or explicit start and end dates like 2026-01 to 2026-09.

## Do
- Make a list of all the post links that satisfy the given condition (ie by default, fetch all the links and details of all the links posted in the last 1 month).
- Do not try to load additional posts as of now.

## Output format

### Weibo

```
no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content
1,https://weibo.com/7435186337/RkvSCaGly,"近日，受台风""白海豚""影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙果庄园的线下采摘及外销渠道受阻，基地约5000斤火龙果集中成熟，大量鲜果面临滞销积压。
台风过境后，象山县新联会积极开展受灾会员走访慰问工作，深入火龙果庄园实地查看灾情，细致询问果园损失与销售难题。了解会员的迫切诉求后，县新联会迅速开展""象新力•助梦计划""爱心助农公益活动，号召广大会员伸出援手，通过以购代扶的方式助力史英子渡过难关。认购活动一经发出便得到热烈响应，广大会员主动接龙下单、踊跃采购。短短48小时内，共有29位会员参与采购，累计认购火龙果396箱，总量达1980斤，及时缓解了果园销售压力，为会员解决了燃眉之急。
本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮""象新力•助梦计划""品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山##象新力##象新力助梦计划 ##寻美浙江##寻美宁波# http://t.cn/AXWaR9da",2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,
2,https://weibo.com/7435186337/RkvMvj9eJ,"近日，受台风""白海豚""影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙果庄园的线下采摘及外销渠道受阻，基地约5000斤火龙果集中成熟，大量鲜果面临滞销积压。
台风过境后，象山县新联会积极开展受灾会员走访慰问工作，深入火龙果庄园实地查看灾情，细致询问果园损失与销售难题。了解会员的迫切诉求后，县新联会迅速开展""象新力•助梦计划""爱心助农公益活动，号召广大会员伸出援手，通过以购代扶的方式助力史英子渡过难关。认购活动一经发出便得到热烈响应，广大会员主动接龙下单、踊跃采购。短短48小时内，共有29位会员参与采购，累计认购火龙果396箱，总量达1980斤，及时缓解了果园销售压力，为会员解决了燃眉之急。
本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮""象新力•助梦计划""品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山 #象新力 #象新力助梦计划 http://t.cn/AXWaQoLH",2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,
:
```

### XHS

```
no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped
1,6abccdd5000000001800471b,2026-09-30 16:52:37,2026-09-30 08:52:37,"近日，受台风""白海豚""影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙",https://www.xiaohongshu.com/explore/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw%3D&xsec_source=pc_user,https://www.rednote.com/discovery/item/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw%3D&xsec_source=pc_user,https://www.rednote.com/user/profile/6308604100000000120013e8/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=&xsec_source=pc_user
2,6abb588c000000001400032d,2026-09-29 14:19:56,2026-09-29 06:19:56,寻美象山 寻美宁波 寻美浙江,https://www.xiaohongshu.com/explore/6abb588c000000001400032d?xsec_token=ABncDfNU27MaDlTJyzr0Q2Bi-lmBfRn9QC-FZv7tW0-eo%3D&xsec_source=pc_user,https://www.rednote.com/discovery/item/6abb588c000000001400032d?xsec_token=ABncDfNU27MaDlTJyzr0Q2Bi-lmBfRn9QC-FZv7tW0-eo%3D&xsec_source=pc_user,https://www.rednote.com/user/profile/6308604100000000120013e8/6abb588c000000001400032d?xsec_token=ABncDfNU27MaDlTJyzr0Q2Bi-lmBfRn9QC-FZv7tW0-eo=&xsec_source=pc_user
:
```

## To consider in output

- Print output as a CSV on the functional call in the developer console.

## Possible improvements

- The aim is to make a snippet that I can paste in the "Inspect tools" developer console. If there's a better way to get this without wrapping it into an executable, let me know.
  - The good thing about our approach is that we don't have to worry about tokens, etc. The loading of the page is done by the person for you.
- Can we automate the loading process also? Is it necessary that I should load all the links for this month on my screen? If possible automate this.

